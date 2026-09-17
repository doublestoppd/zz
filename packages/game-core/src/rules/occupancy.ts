import type { PlayerId } from "../ids.js";
import { positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState } from "../state/types.js";

/**
 * True when any player or zombie stands on `position`.
 * `ignorePlayerId` excludes the mover so its own tile does not count as occupied.
 */
export function isOccupied(
  state: GameState,
  position: Position,
  ignorePlayerId?: PlayerId,
): boolean {
  const byPlayer = state.players.some(
    (p) => p.id !== ignorePlayerId && positionsEqual(p.position, position),
  );
  if (byPlayer) return true;
  return state.zombies.some((z) => positionsEqual(z.position, position));
}
