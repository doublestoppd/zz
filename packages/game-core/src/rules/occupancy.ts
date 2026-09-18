import type { PlayerId, ZombieId } from "../ids.js";
import { positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { IsPassable } from "../pathfinding/bfs.js";
import type { GameState } from "../state/types.js";
import { isBlockedByBarrier } from "../state/barriers.js";

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

/** Who is trying to move. Determines what counts as an obstacle. */
export type Mover =
  | { readonly kind: "survivor"; readonly id: PlayerId }
  | { readonly kind: "zombie"; readonly id: ZombieId };

/**
 * The single definition of "may this mover travel through that tile", used by every
 * pathfinding call in the rules. Survivors treat every entity as a wall. Zombies treat
 * survivors as walls but plan through other zombies so a queue keeps pursuing; they still
 * cannot end a step on an occupied tile (see `canStandOn`). Static terrain is handled by
 * the search itself; closed and locked doors and intact windows stop everyone, since no
 * mover opens or breaks anything while pathing (survivors interact by command; zombies
 * cannot interact at all).
 */
export function passabilityFor(state: GameState, mover: Mover): IsPassable {
  switch (mover.kind) {
    case "survivor":
      return (p) => !isBlockedByBarrier(state, p) && !isOccupied(state, p, mover.id);
    case "zombie":
      return (p) => !isBlockedByBarrier(state, p) && !isOccupiedByPlayer(state, p);
  }
}

/** Whether `mover` may finish a move on `position`: no barrier and nothing else may stand there. */
export function canStandOn(state: GameState, position: Position, mover: Mover): boolean {
  return !isBlockedByBarrier(state, position) && !isOccupied(state, position, mover.id);
}
