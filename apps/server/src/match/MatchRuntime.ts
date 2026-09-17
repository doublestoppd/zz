import { applyCommand, type Command, type CommandResult, type GameState } from "@zombie/game-core";

/**
 * Holds the authoritative state of one running match and the version counter that
 * orders snapshots. This is the only mutable reference to game state on the server.
 */
export class MatchRuntime {
  private state: GameState;
  private version = 0;

  constructor(initialState: GameState) {
    this.state = initialState;
  }

  getState(): GameState {
    return this.state;
  }

  getVersion(): number {
    return this.version;
  }

  /** Applies a command through game-core. Accepted commands advance the version. */
  apply(command: Command): CommandResult {
    const result = applyCommand(this.state, command);
    if (result.ok) {
      this.state = result.state;
      this.version += 1;
    }
    return result;
  }
}
