import type { ContainerId } from "../ids.js";
import { chebyshevDistance } from "../map/position.js";
import { hashString } from "../random/hash.js";
import { createRng, deriveSeed, RNG_STREAM } from "../random/rng.js";
import { pickWeighted } from "../random/weighted.js";
import type { GameState, ItemType, PlayerState, SearchableContainer } from "../state/types.js";
import { discounted, modifiersOf } from "./specialties.js";

/** A survivor may search a container on their own tile or an orthogonally/diagonally adjacent one. */
export const SEARCH_REACH = 1;

export type SearchRejectionReason =
  | "CONTAINER_NOT_FOUND"
  | "CONTAINER_OUT_OF_REACH"
  | "CONTAINER_ALREADY_SEARCHED"
  | "INSUFFICIENT_ACTION_POINTS";

export type SearchValidation =
  | { readonly ok: true; readonly container: SearchableContainer; readonly cost: number }
  | { readonly ok: false; readonly reason: SearchRejectionReason };

/** Reasons in order: the container exists, it is within reach, it is untouched, action points. */
export function validateSearch(
  state: GameState,
  player: PlayerState,
  id: ContainerId,
): SearchValidation {
  const container = state.containers.find((c) => c.id === id);
  if (container === undefined) return { ok: false, reason: "CONTAINER_NOT_FOUND" };
  if (chebyshevDistance(player.position, container.position) > SEARCH_REACH) {
    return { ok: false, reason: "CONTAINER_OUT_OF_REACH" };
  }
  if (container.searched) return { ok: false, reason: "CONTAINER_ALREADY_SEARCHED" };
  const cost = discounted(
    state.rules.searchActionPointCost,
    modifiersOf(state, player).searchActionPointDiscount,
  );
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, container, cost };
}

/** Unsearched containers `player` could search right now. Used by the client to highlight them. */
export function searchableContainersInReach(
  state: GameState,
  player: PlayerState,
): SearchableContainer[] {
  return state.containers.filter(
    (c) => !c.searched && chebyshevDistance(player.position, c.position) <= SEARCH_REACH,
  );
}

/**
 * What a container holds. Rolled from the match seed and the container's id, so the same
 * seed always puts the same loot in the same place no matter who searches or in what
 * order; a searcher's `searchExtraRolls` adds draws at the end of that fixed sequence, so
 * a scavenger finds everything anyone else would plus more. Draws come from the table for
 * the container's category; "nothing" draws yield no item.
 */
export function rollSearchLoot(
  state: GameState,
  container: SearchableContainer,
  extraRolls = 0,
): ItemType[] {
  const table = state.rules.searchLootTables[container.category];
  const rng = createRng(
    deriveSeed(deriveSeed(state.seed, RNG_STREAM.search), hashString(container.id)),
  );
  const rolls = rng.int(table.minRolls, table.maxRolls) + extraRolls;
  const found: ItemType[] = [];
  for (let i = 0; i < rolls; i += 1) {
    const drawn = pickWeighted(table.entries, rng);
    if (drawn !== "nothing") found.push(drawn);
  }
  return found;
}
