import { orthogonalNeighbours, positionsEqual, tileAt } from "../map/position.js";
import type { Position } from "../map/types.js";
import { searchFrom } from "../pathfinding/bfs.js";
import { canStandOn, passabilityFor } from "../rules/occupancy.js";
import type { GameState, PlayerState, ZombieState } from "../state/types.js";

/** What a zombie decided to do this phase. `wait` means no target could be reached. */
export type ZombieDecision =
  | { readonly kind: "attack"; readonly target: PlayerState }
  | { readonly kind: "step"; readonly to: Position; readonly target: PlayerState }
  | { readonly kind: "wait" };

/** Zombies pursue survivors who are still standing, connected or not. */
function isTargetable(player: PlayerState): boolean {
  return player.status === "active";
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * Picks the zombie's action for this phase:
 *   1. If a standing survivor is orthogonally adjacent, attack the first in turn order.
 *   2. Otherwise walk one step along the shortest path to the free tile next to the
 *      nearest standing survivor. Ties are broken by turn order so the result is
 *      deterministic without randomness.
 *   3. If no survivor is reachable, or the next tile is occupied, wait.
 *
 * Survivors block paths. Other zombies do not block the search (so a queue of zombies in
 * a corridor keeps pursuing), but a zombie never steps onto an occupied tile.
 */
export function decideZombieAction(state: GameState, zombie: ZombieState): ZombieDecision {
  const targets = state.turnOrder
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p): p is PlayerState => p !== undefined && isTargetable(p));

  const adjacent = targets.find((p) => isAdjacent(p.position, zombie.position));
  if (adjacent !== undefined) return { kind: "attack", target: adjacent };

  const mover = { kind: "zombie", id: zombie.id } as const;
  const unlimited = state.map.width * state.map.height;
  const reach = searchFrom(state.map, zombie.position, unlimited, passabilityFor(state, mover));

  let best: { distance: number; goal: Position; target: PlayerState } | undefined;
  for (const target of targets) {
    for (const goal of orthogonalNeighbours(state.map, target.position)) {
      if (!(tileAt(state.map, goal)?.walkable ?? false)) continue;
      if (positionsEqual(goal, zombie.position)) continue; // would have been an attack
      const distance = reach.distanceTo(goal);
      if (distance === undefined) continue;
      if (best === undefined || distance < best.distance) best = { distance, goal, target };
    }
  }
  if (best === undefined) return { kind: "wait" };
  const path = reach.pathTo(best.goal);
  const first = path?.[0];
  if (first === undefined || !canStandOn(state, first, mover)) return { kind: "wait" };
  return { kind: "step", to: first, target: best.target };
}
