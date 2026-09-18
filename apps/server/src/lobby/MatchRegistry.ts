import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchJournal } from "@zombie/game-core";
import { log } from "../log.js";
import { metrics } from "../observability/metrics.js";
import { MemoryMatchStore, type MatchStore } from "../persistence/matchStore.js";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";
import { ServerMatch, type MatchDependencies } from "../match/ServerMatch.js";

/** Letters that are hard to confuse when read aloud or typed. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** A started match nobody is connected to is kept this long so players can rejoin. */
export const ABANDONED_MATCH_TTL_MS = 10 * 60 * 1000;

/** How delayed work is scheduled; tests inject a manual one so nothing sleeps. */
export interface Scheduler {
  schedule(callback: () => void, delayMs: number): { cancel(): void };
}

const REAL_SCHEDULER: Scheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return {
      cancel: () => {
        clearTimeout(timer);
      },
    };
  },
};

export interface RegistryOptions {
  readonly deps?: MatchDependencies;
  readonly abandonedMatchTtlMs?: number;
  readonly scheduler?: Scheduler;
  /** Records are checkpointed here and restored from here; memory when absent. */
  readonly store?: MatchStore;
  readonly completedRetentionMs?: number;
  /** Lobbies plus matches held in memory at once; `create_match` beyond it is `SERVER_FULL`. */
  readonly maxMatches?: number;
  /**
   * Failed lookups (unknown code, bad rejoin token) an address may make per window before
   * its joins are answered `RATE_LIMITED`, so match codes cannot be enumerated quickly.
   */
  readonly lookupFailures?: { readonly max: number; readonly windowMs: number };
}

/** Default room capacity for one process; a small VM holds far more, but memory is not the limit, fairness is. */
export const MAX_MATCHES = 100;
const LOOKUP_FAILURES = { max: 10, windowMs: 60_000 } as const;

/** Completed matches are kept this long for players to reread and for bug reports, then swept. */
export const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Production sources: random seeds and tokens, generated cities, journals to `JOURNAL_DIR`. */
export const DEFAULT_MATCH_DEPENDENCIES: MatchDependencies = {
  createSeed: () => randomInt(0, 2 ** 32),
  createRejoinToken: () => randomUUID(),
  // One spawn per player, so the player cap (protocol MAX_PLAYERS) is the only limit.
  // Opposition and loot scale with the party (docs/BALANCE.md): 4 to 7 zombies, 3 to 6 items.
  createLayout: (seed, playerCount) => {
    const options = {
      ...DEFAULT_CITY_OPTIONS,
      survivorSpawns: playerCount,
      zombieSpawns: 3 + playerCount,
      lootSpawns: 2 + playerCount,
    };
    try {
      return {
        layout: metrics.time("zombie_map_generation_duration_ms", {}, () =>
          generateCity({ ...options, seed }),
        ),
        source: { kind: "city", options },
      };
    } catch (error) {
      metrics.increment("zombie_map_generation_failures_total");
      throw error;
    }
  },
  onJournal: writeJournalIfConfigured,
};

/**
 * Writes a finished match's journal to `JOURNAL_DIR` as `<matchId>-<seed>.json` when that
 * directory is configured. The file holds no credential (docs/DEVELOPMENT.md, "Replay a
 * match"). A write failure is logged, never thrown into the match.
 */
export function writeJournalIfConfigured(journal: MatchJournal): void {
  const dir = process.env.JOURNAL_DIR;
  if (dir === undefined || dir === "") return;
  const file = join(dir, `${journal.metadata.matchId}-${journal.metadata.seed}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(journal));
    log("info", "journal written", { matchId: journal.metadata.matchId, file });
  } catch (error) {
    log("error", "journal write failed", {
      matchId: journal.metadata.matchId,
      file,
      error: String(error),
    });
  }
}

/** Every live lobby and match, keyed by join code. Removes matches nobody can return to. */
export class MatchRegistry {
  private readonly matches = new Map<string, ServerMatch>();
  private readonly abandonTimers = new Map<string, { cancel(): void }>();
  private readonly deps: MatchDependencies;
  private readonly abandonedMatchTtlMs: number;
  private readonly scheduler: Scheduler;

  private readonly store: MatchStore;
  private readonly completedRetentionMs: number;
  private readonly maxMatches: number;
  private readonly lookupFailures: { readonly max: number; readonly windowMs: number };
  private readonly failedLookups = new Map<string, { count: number; windowStart: number }>();
  private draining = false;

  constructor(options: RegistryOptions = {}) {
    this.store = options.store ?? new MemoryMatchStore();
    this.deps = { ...(options.deps ?? DEFAULT_MATCH_DEPENDENCIES), store: this.store };
    this.abandonedMatchTtlMs = options.abandonedMatchTtlMs ?? ABANDONED_MATCH_TTL_MS;
    this.completedRetentionMs = options.completedRetentionMs ?? COMPLETED_RETENTION_MS;
    this.scheduler = options.scheduler ?? REAL_SCHEDULER;
    this.maxMatches = options.maxMatches ?? MAX_MATCHES;
    this.lookupFailures = options.lookupFailures ?? LOOKUP_FAILURES;
  }

  /** False while `address` has exhausted its failed-lookup allowance for the current window. */
  allowLookup(address: string, now = Date.now()): boolean {
    const entry = this.failedLookups.get(address);
    if (entry === undefined) return true;
    if (now - entry.windowStart >= this.lookupFailures.windowMs) {
      this.failedLookups.delete(address);
      return true;
    }
    return entry.count < this.lookupFailures.max;
  }

  /** Records a join or rejoin that named a match or token that does not exist. */
  noteLookupFailure(address: string, now = Date.now()): void {
    const entry = this.failedLookups.get(address);
    if (entry === undefined || now - entry.windowStart >= this.lookupFailures.windowMs) {
      this.failedLookups.set(address, { count: 1, windowStart: now });
    } else {
      entry.count += 1;
    }
    // Bounded memory: forget addresses whose window has passed once the table grows.
    if (this.failedLookups.size > 10_000) {
      for (const [key, value] of this.failedLookups) {
        if (now - value.windowStart >= this.lookupFailures.windowMs) this.failedLookups.delete(key);
      }
    }
  }

  /**
   * Brings back every active match the store holds (lobbies are not kept, completed ones
   * only as records for their retention period). A record that will not replay is logged
   * with its reason and removed rather than served in a doubtful state. Restored matches
   * start with nobody connected, so the abandonment grace period starts at once.
   */
  restore(): { restored: number; discarded: number } {
    let restored = 0;
    let discarded = 0;
    for (const record of this.store.list()) {
      if (record.status !== "active") {
        if (
          record.status === "completed" &&
          Date.now() - record.savedAt < this.completedRetentionMs
        )
          continue;
        this.store.delete(record.code);
        discarded += 1;
        continue;
      }
      try {
        const match = ServerMatch.restore(record, this.deps);
        this.matches.set(match.code, match);
        this.noteMembershipChanged(match);
        restored += 1;
        metrics.increment("zombie_matches_restored_total");
        log("info", "match restored", {
          category: "lifecycle",
          matchCode: match.code,
          revision: record.journal.entries.length,
        });
      } catch (error) {
        log("error", "match not restorable", { matchCode: record.code, reason: String(error) });
        this.store.delete(record.code);
        discarded += 1;
      }
    }
    return { restored, discarded };
  }

  /** True while the server is shutting down: no lobby may be created or joined. */
  isDraining(): boolean {
    return this.draining;
  }

  /**
   * Graceful shutdown: refuse new lobbies, make sure every active match is checkpointed
   * (it is, after every mutation), and tell every connected player the server is going
   * away so their client reconnects to the restored match. Lobbies that never started are
   * simply dropped.
   */
  shutdown(): { active: number; lobbies: number } {
    this.draining = true;
    let active = 0;
    let lobbies = 0;
    for (const match of this.matches.values()) {
      if (match.isStarted()) active += 1;
      else lobbies += 1;
      match.closeAll();
    }
    for (const timer of this.abandonTimers.values()) timer.cancel();
    this.abandonTimers.clear();
    log("info", "registry drained", { active, lobbies });
    return { active, lobbies };
  }

  create(): ServerMatch | "SHUTTING_DOWN" | "SERVER_FULL" {
    if (this.draining) return "SHUTTING_DOWN";
    if (this.matches.size >= this.maxMatches) {
      metrics.increment("zombie_matches_refused_total");
      return "SERVER_FULL";
    }
    let code = this.randomCode();
    while (this.matches.has(code)) code = this.randomCode();
    const match = new ServerMatch(code, this.deps);
    this.matches.set(code, match);
    this.updateGauges();
    return match;
  }

  /** What the diagnostics endpoints and readiness probe read. */
  diagnostics(): {
    listMatches: () => unknown;
    describeMatch: (code: string) => unknown;
    isReady: () => boolean;
  } {
    return {
      listMatches: () =>
        [...this.matches.values()].map((m) => {
          const { metadata: _metadata, ...summary } = m.describe();
          return summary;
        }),
      describeMatch: (code) => this.get(code)?.describe(),
      isReady: () => !this.draining,
    };
  }

  /**
   * Metrics text for `/metrics`. Registry gauges (matches, lobbies, connected players) are
   * derived from the live matches on every scrape rather than kept up to date on every
   * transition, so a scrape can never observe a stale count.
   */
  metricsText(): string {
    this.updateGauges();
    return metrics.render();
  }

  private updateGauges(): void {
    let active = 0;
    let lobbies = 0;
    let connected = 0;
    for (const match of this.matches.values()) {
      if (match.isStarted()) active += 1;
      else lobbies += 1;
      connected += match.describe().players.filter((p) => p.connected).length;
    }
    metrics.set("zombie_active_matches", active);
    metrics.set("zombie_lobbies", lobbies);
    metrics.set("zombie_connected_players", connected);
  }

  get(code: string): ServerMatch | undefined {
    return this.matches.get(code.trim().toUpperCase());
  }

  /** Call after any join, rejoin, or disconnect so abandoned matches are cleaned up. */
  noteMembershipChanged(match: ServerMatch): void {
    this.updateGauges();
    const existingTimer = this.abandonTimers.get(match.code);
    if (existingTimer !== undefined) {
      existingTimer.cancel();
      this.abandonTimers.delete(match.code);
    }
    if (!match.hasNoPresentMembers()) return;

    if (!match.isStarted() || match.memberCount() === 0) {
      this.matches.delete(match.code);
      return;
    }
    const timer = this.scheduler.schedule(() => {
      this.abandonTimers.delete(match.code);
      if (!match.hasNoPresentMembers()) return;
      if (match.getStatus() === "completed") {
        // Completed records stay for their retention period; only the live object goes.
        this.matches.delete(match.code);
        return;
      }
      match.markAbandoned();
      this.matches.delete(match.code);
      metrics.increment("zombie_matches_abandoned_total");
      this.updateGauges();
      log("info", "match abandoned", { category: "lifecycle", matchCode: match.code });
    }, this.abandonedMatchTtlMs);
    this.abandonTimers.set(match.code, timer);
  }

  size(): number {
    return this.matches.size;
  }

  private randomCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)] ?? "A";
    }
    return code;
  }
}
