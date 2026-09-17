import type { PlayerId } from "../ids.js";
import type { GameState, PlayerState } from "../state/types.js";

/** A player may take a turn while present and not down. A later milestone adds "not extracted". */
export function isEligibleToAct(player: PlayerState): boolean {
  return player.present && player.status === "active";
}

function eligibleIds(state: GameState): PlayerId[] {
  return state.turnOrder.filter((id) => {
    const player = state.players.find((p) => p.id === id);
    return player !== undefined && isEligibleToAct(player);
  });
}

/** The first eligible player in turn order, or undefined when nobody can act. */
export function firstEligiblePlayer(state: GameState): PlayerId | undefined {
  return eligibleIds(state)[0];
}

/**
 * The next eligible player strictly after `current` in turn order, without wrapping.
 * Undefined means every remaining player this round is ineligible and the round moves on.
 */
export function nextEligiblePlayerAfter(state: GameState, current: PlayerId): PlayerId | undefined {
  const index = state.turnOrder.indexOf(current);
  if (index === -1) return undefined;
  const remaining = state.turnOrder.slice(index + 1);
  return eligibleIds({ ...state, turnOrder: remaining })[0];
}

export function hasEligiblePlayer(state: GameState): boolean {
  return eligibleIds(state).length > 0;
}
