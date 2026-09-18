import { applyCommand, type Command, type CommandResult, type GameState } from "@zombie/game-core";

/**
 * Holds the authoritative state of one running match and its revision: 0 at match start,
 * +1 for every accepted mutation, whoever caused it. This is the only mutable reference to
 * game state on the server, and the revision is the only thing clients synchronise on.
 */
export class MatchRuntime {
  private state: GameState;
  private revision = 0;

  constructor(initialState: GameState, revision = 0) {
    this.state = initialState;
    this.revision = revision;
  }

  getState(): GameState {
    return this.state;
  }

  getRevision(): number {
    return this.revision;
  }

  /** Applies a command through game-core. Accepted commands advance the revision by one. */
  apply(command: Command): CommandResult {
    const result = applyCommand(this.state, command);
    if (result.ok) {
      this.state = result.state;
      this.revision += 1;
    }
    return result;
  }
}
