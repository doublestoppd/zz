import type { PlayerId, ZombieId } from "../ids.js";
import { positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState } from "../state/types.js";

/**
 * True when any player (active or down) or zombie stands on `position`.
 * `ignoreId` excludes the mover so its own tile does not count as occupied.
 */
export function isOccupied(
  state: GameState,
  position: Position,
  ignoreId?: PlayerId | ZombieId,
): boolean {
  const byPlayer = state.players.some(
    (p) => p.id !== ignoreId && positionsEqual(p.position, position),
  );
  if (byPlayer) return true;
  return state.zombies.some((z) => z.id !== ignoreId && positionsEqual(z.position, position));
}

/** True when a player (active or down) stands on `position`. Zombies are ignored. */
export function isOccupiedByPlayer(state: GameState, position: Position): boolean {
  return state.players.some((p) => positionsEqual(p.position, position));
}
