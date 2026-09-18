import type { Command } from "../commands/types.js";
import { applyCommand } from "../commands/applyCommand.js";
import { checkInvariants, type InvariantViolation } from "../state/invariants.js";
import type { MatchId } from "../ids.js";
import type { GamePhase, GameState, ScenarioType, SpecialtyType } from "../state/types.js";
import { SIMULATION_VERSION } from "../version.js";
import { fingerprint } from "./canonical.js";

/**
 * Where the board came from, in enough detail to rebuild it. Generated cities are
 * described by their options; hand-authored fixtures by name. Both are resolved outside
 * game-core (the verifier in the server app knows map-generation and the fixtures).
 */
export type LayoutSource =
  | { readonly kind: "city"; readonly options: Readonly<Record<string, number>> }
  | { readonly kind: "fixture"; readonly name: string };

/** Everything needed to rebuild the initial state of a match, minus the rule tables, which the build supplies. */
export interface JournalMetadata {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly gameVersion: string;
  readonly protocolVersion: number;
  readonly simulationVersion: number;
  readonly scenario: ScenarioType;
  readonly layout: LayoutSource;
  readonly players: readonly {
    readonly id: string;
    readonly name: string;
    readonly specialty: SpecialtyType;
  }[];
}

/** One accepted authoritative mutation and where the match stood after it. */
export interface JournalEntry {
  /** The revision the mutation produced. */
  readonly revision: number;
  /** The command exactly as game-core applied it, player id included. */
  readonly command: Command;
  readonly round: number;
  readonly phase: GamePhase["kind"];
  /** Fingerprint of the canonical state after the command: the replay checkpoint. */
  readonly checkpoint: string;
}

/**
 * A match, reproducibly. Commands are the source of truth: events are derived and are not
 * recorded. No credential ever belongs here; player ids and names are already public.
 */
export interface MatchJournal {
  readonly journalVersion: 1;
  readonly metadata: JournalMetadata;
  /** Fingerprint of the initial state (revision 0). */
  readonly initialCheckpoint: string;
  readonly entries: readonly JournalEntry[];
}

/** Builds a journal entry for a mutation that was just accepted. */
export function journalEntry(revision: number, command: Command, after: GameState): JournalEntry {
  return {
    revision,
    command,
    round: after.round,
    phase: after.phase.kind,
    checkpoint: fingerprint(after),
  };
}

export type ReplayVerdict =
  | { readonly ok: true; readonly finalCheckpoint: string; readonly entries: number }
  | {
      readonly ok: false;
      readonly reason: "UNSUPPORTED_SIMULATION_VERSION";
      readonly recorded: number;
      readonly supported: number;
    }
  | {
      readonly ok: false;
      readonly reason: "INITIAL_STATE_MISMATCH";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly ok: false;
      readonly reason: "COMMAND_REJECTED";
      readonly revision: number;
      readonly rejection: string;
    }
  | {
      readonly ok: false;
      readonly reason: "CHECKPOINT_MISMATCH";
      readonly revision: number;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly ok: false;
      readonly reason: "INVARIANT_VIOLATION";
      readonly revision: number;
      readonly violations: readonly InvariantViolation[];
    };

/**
 * Re-applies a journal's commands to a rebuilt initial state and compares every checkpoint.
 * The caller rebuilds the initial state from the metadata (rules and layout live outside
 * game-core). A journal from another simulation version is refused up front.
 */
export function replayJournal(journal: MatchJournal, initial: GameState): ReplayVerdict {
  if (journal.metadata.simulationVersion !== SIMULATION_VERSION) {
    return {
      ok: false,
      reason: "UNSUPPORTED_SIMULATION_VERSION",
      recorded: journal.metadata.simulationVersion,
      supported: SIMULATION_VERSION,
    };
  }
  const initialCheckpoint = fingerprint(initial);
  if (initialCheckpoint !== journal.initialCheckpoint) {
    return {
      ok: false,
      reason: "INITIAL_STATE_MISMATCH",
      expected: journal.initialCheckpoint,
      actual: initialCheckpoint,
    };
  }
  let state = initial;
  for (const entry of journal.entries) {
    const result = applyCommand(state, entry.command);
    if (!result.ok) {
      return {
        ok: false,
        reason: "COMMAND_REJECTED",
        revision: entry.revision,
        rejection: result.reason,
      };
    }
    state = result.state;
    const actual = fingerprint(state);
    if (actual !== entry.checkpoint) {
      return {
        ok: false,
        reason: "CHECKPOINT_MISMATCH",
        revision: entry.revision,
        expected: entry.checkpoint,
        actual,
      };
    }
    // A journal that replays exactly can still describe a state the rules never allow
    // (a build that recorded it had a bug): refuse it rather than restore or trust it.
    const violations = checkInvariants(state, "full");
    if (violations.length > 0) {
      return { ok: false, reason: "INVARIANT_VIOLATION", revision: entry.revision, violations };
    }
  }
  return { ok: true, finalCheckpoint: fingerprint(state), entries: journal.entries.length };
}
