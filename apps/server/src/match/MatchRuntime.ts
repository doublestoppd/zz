import {
  applyCommand,
  checkInvariants,
  type Command,
  type CommandResult,
  type GameState,
  type InvariantLevel,
  type InvariantViolation,
} from "@zombie/game-core";

/** How the runtime checks the state a command produced; the default is game-core's checker. */
export interface RuntimeOptions {
  /** `critical` (production default) or `full` (tests, development, the soak). */
  readonly invariantLevel?: InvariantLevel;
  /** Test seam: replaces the checker so a violation can be provoked on a legal command. */
  readonly invariantCheck?: (state: GameState, level: InvariantLevel) => InvariantViolation[];
}

/**
 * A command's outcome at the runtime: game-core's result, or a refusal because the state
 * the rules produced breaks an invariant. In the second case nothing changed: the previous
 * state and revision stand, and the caller answers the client with a fixed error.
 */
export type RuntimeResult =
  | CommandResult
  | {
      readonly ok: false;
      readonly reason: "STATE_INVARIANT";
      readonly violations: readonly InvariantViolation[];
    };

/**
 * The single mutable reference to a match's authoritative `GameState`. Every change goes
 * through `apply`, which advances the revision by exactly one per accepted command, so the
 * revision is monotonic by construction and never edited elsewhere.
 */
export class MatchRuntime {
  private state: GameState;
  private revision = 0;
  private readonly level: InvariantLevel;
  private readonly check: (state: GameState, level: InvariantLevel) => InvariantViolation[];

  constructor(initialState: GameState, revision = 0, options: RuntimeOptions = {}) {
    this.state = initialState;
    this.revision = revision;
    this.level = options.invariantLevel ?? "critical";
    this.check = options.invariantCheck ?? checkInvariants;
  }

  getState(): GameState {
    return this.state;
  }

  getRevision(): number {
    return this.revision;
  }

  /**
   * Applies a command through game-core. Accepted commands advance the revision by one.
   * A resulting state that fails the invariant check is discarded: known-corrupt state
   * never becomes authoritative, the previous state stays, and the caller reports it.
   */
  apply(command: Command): RuntimeResult {
    const result = applyCommand(this.state, command);
    if (!result.ok) return result;
    const violations = this.check(result.state, this.level);
    if (violations.length > 0) return { ok: false, reason: "STATE_INVARIANT", violations };
    this.state = result.state;
    this.revision += 1;
    return result;
  }
}
