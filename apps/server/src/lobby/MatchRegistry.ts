import { randomInt, randomUUID } from "node:crypto";
import { ServerMatch, type MatchDependencies } from "../match/ServerMatch.js";

/** Letters that are hard to confuse when read aloud or typed. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** A started match nobody is connected to is kept this long so players can rejoin. */
export const ABANDONED_MATCH_TTL_MS = 10 * 60 * 1000;

export interface RegistryOptions {
  readonly deps?: MatchDependencies;
  readonly abandonedMatchTtlMs?: number;
}

const DEFAULT_DEPS: MatchDependencies = {
  createSeed: () => randomInt(0, 2 ** 32),
  createRejoinToken: () => randomUUID(),
};

/** Every live lobby and match, keyed by join code. Removes matches nobody can return to. */
export class MatchRegistry {
  private readonly matches = new Map<string, ServerMatch>();
  private readonly abandonTimers = new Map<string, NodeJS.Timeout>();
  private readonly deps: MatchDependencies;
  private readonly abandonedMatchTtlMs: number;

  constructor(options: RegistryOptions = {}) {
    this.deps = options.deps ?? DEFAULT_DEPS;
    this.abandonedMatchTtlMs = options.abandonedMatchTtlMs ?? ABANDONED_MATCH_TTL_MS;
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
      clearTimeout(existingTimer);
      this.abandonTimers.delete(match.code);
    }
    if (!match.hasNoPresentMembers()) return;

    if (!match.isStarted() || match.memberCount() === 0) {
      this.matches.delete(match.code);
      return;
    }
    const timer = setTimeout(() => {
      this.abandonTimers.delete(match.code);
      if (match.hasNoPresentMembers()) this.matches.delete(match.code);
    }, this.abandonedMatchTtlMs);
    timer.unref();
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
