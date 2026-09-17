import type { PlayerId } from "../ids.js";
import type { GameState, PlayerState } from "./types.js";

export function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

/** Returns a new state with the player of the same id replaced. Unknown ids are ignored. */
export function replacePlayer(state: GameState, updated: PlayerState): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === updated.id ? updated : p)),
  };
}
