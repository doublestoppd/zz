import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchJournal } from "@zombie/game-core";
import { log } from "../log.js";
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
}

/** Completed matches are kept this long for players to reread and for bug reports, then swept. */
export const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;

const DEFAULT_DEPS: MatchDependencies = {
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
    return {
      layout: generateCity({ ...options, seed }),
      source: { kind: "city", options },
    };
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
  private draining = false;

  constructor(options: RegistryOptions = {}) {
    this.store = options.store ?? new MemoryMatchStore();
    this.deps = { ...(options.deps ?? DEFAULT_DEPS), store: this.store };
    this.abandonedMatchTtlMs = options.abandonedMatchTtlMs ?? ABANDONED_MATCH_TTL_MS;
    this.completedRetentionMs = options.completedRetentionMs ?? COMPLETED_RETENTION_MS;
    this.scheduler = options.scheduler ?? REAL_SCHEDULER;
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
        log("info", "match restored", {
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

  create(): ServerMatch | undefined {
    if (this.draining) return undefined;
    let code = this.randomCode();
    while (this.matches.has(code)) code = this.randomCode();
    const match = new ServerMatch(code, this.deps);
    this.matches.set(code, match);
    return match;
  }

  get(code: string): ServerMatch | undefined {
    return this.matches.get(code.trim().toUpperCase());
  }

  /** Call after any join, rejoin, or disconnect so abandoned matches are cleaned up. */
  noteMembershipChanged(match: ServerMatch): void {
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
      log("info", "match abandoned", { matchCode: match.code });
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
