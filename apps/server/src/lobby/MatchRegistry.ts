import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchJournal } from "@zombie/game-core";
import { log } from "../log.js";
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
}

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

  constructor(options: RegistryOptions = {}) {
    this.deps = options.deps ?? DEFAULT_DEPS;
    this.abandonedMatchTtlMs = options.abandonedMatchTtlMs ?? ABANDONED_MATCH_TTL_MS;
    this.scheduler = options.scheduler ?? REAL_SCHEDULER;
  }

  create(): ServerMatch {
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
      if (match.hasNoPresentMembers()) this.matches.delete(match.code);
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
