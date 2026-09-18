import {
  chebyshevDistance,
  orthogonalNeighbours,
  positionsEqual,
  tileAt,
} from "../map/position.js";
import type { Position } from "../map/types.js";
import { searchFrom, type Reachability } from "../pathfinding/bfs.js";
import { hasLineOfSight } from "../rules/lineOfSight.js";
import { canHear, noiseScore } from "../rules/noise.js";
import { canStandOn, passabilityFor, type Mover } from "../rules/occupancy.js";
import type { GameState, NoiseEvent, PlayerState, ZombieState } from "../state/types.js";

/**
 * What a zombie decided to do this phase. `investigating` is the noise position to
 * remember afterwards (undefined forgets); it is carried on every decision so the phase
 * runner never has to guess.
 */
export type ZombieDecision =
  | { readonly kind: "attack"; readonly target: PlayerState }
  | {
      readonly kind: "step";
      readonly to: Position;
      readonly reason: "pursue" | "investigate";
      readonly investigating: Position | undefined;
    }
  | { readonly kind: "wait"; readonly investigating: Position | undefined };

/** Zombies pursue survivors who are still standing, connected or not. */
function isTargetable(player: PlayerState): boolean {
  return player.status === "active";
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** A survivor is seen within the zombie's sight range with a clear line of sight. */
export function canSee(state: GameState, zombie: ZombieState, player: PlayerState): boolean {
  const range = state.rules.zombieDefinitions[zombie.type].sightRange;
  return (
    chebyshevDistance(zombie.position, player.position) <= range &&
    hasLineOfSight(state, zombie.position, player.position)
  );
}

/**
 * The noise this zombie would go to: the best score (intensity minus distance) among the
 * noises it can hear; ties go to the earlier noise so the choice is deterministic.
 */
export function bestAudibleNoise(state: GameState, zombie: ZombieState): NoiseEvent | undefined {
  let best: NoiseEvent | undefined;
  for (const noise of state.noises) {
    if (!canHear(zombie.position, noise)) continue;
    if (
      best === undefined ||
      noiseScore(zombie.position, noise) > noiseScore(zombie.position, best)
    ) {
      best = noise;
    }
  }
  return best;
}

/**
 * Picks the zombie's action for this phase, in priority order:
 *   1. attack a standing survivor who is orthogonally adjacent (first in turn order);
 *   2. otherwise walk toward the nearest survivor it can see (sight range and line of
 *      sight), by shortest path to a free tile next to them, ties by turn order;
 *   3. otherwise walk toward a noise: the best audible one this phase, or the position it
 *      remembered from an earlier phase, heading for the spot or the nearest walkable tile
 *      beside it; arriving on or next to the spot forgets it, as does finding it
 *      unreachable;
 *   4. otherwise wait where it is.
 *
 * Survivors block paths. Other zombies do not block the search (so a queue of zombies in
 * a corridor keeps moving), but a zombie never steps onto an occupied tile.
 */
export function decideZombieAction(state: GameState, zombie: ZombieState): ZombieDecision {
  const targets = state.turnOrder
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p): p is PlayerState => p !== undefined && isTargetable(p));

  const adjacent = targets.find((p) => isAdjacent(p.position, zombie.position));
  if (adjacent !== undefined) return { kind: "attack", target: adjacent };

  const mover: Mover = { kind: "zombie", id: zombie.id };
  const unlimited = state.map.width * state.map.height;
  const reach = searchFrom(state.map, zombie.position, unlimited, passabilityFor(state, mover));

  const visible = targets.filter((p) => canSee(state, zombie, p));
  if (visible.length > 0) {
    const goal = nearestAdjacentGoal(state, zombie, reach, visible);
    const step = goal === undefined ? undefined : firstFreeStep(state, mover, reach, goal);
    return step === undefined
      ? { kind: "wait", investigating: undefined }
      : { kind: "step", to: step, reason: "pursue", investigating: undefined };
  }

  const heard = bestAudibleNoise(state, zombie);
  const spot = heard?.position ?? zombie.investigating;
  if (spot === undefined) return { kind: "wait", investigating: undefined };
  if (chebyshevDistance(zombie.position, spot) <= 1)
    return { kind: "wait", investigating: undefined };
  const goal = investigationGoal(state, reach, spot);
  if (goal === undefined) return { kind: "wait", investigating: undefined };
  const step = firstFreeStep(state, mover, reach, goal);
  return step === undefined
    ? { kind: "wait", investigating: spot }
    : { kind: "step", to: step, reason: "investigate", investigating: spot };
}

/**
 * Where a zombie walks to when investigating `spot`: the spot itself, or the nearest
 * walkable tile next to it when the spot is unreachable (a survivor is still standing on
 * it, for instance). Undefined when nothing around the spot can be reached.
 */
function investigationGoal(
  state: GameState,
  reach: Reachability,
  spot: Position,
): Position | undefined {
  let best: { distance: number; goal: Position } | undefined;
  for (const goal of [spot, ...orthogonalNeighbours(state.map, spot)]) {
    if (!(tileAt(state.map, goal)?.walkable ?? false)) continue;
    const distance = reach.distanceTo(goal);
    if (distance === undefined) continue;
    if (best === undefined || distance < best.distance) best = { distance, goal };
  }
  return best?.goal;
}

/** The free tile next to the nearest of `targets` (by path length), or undefined. */
function nearestAdjacentGoal(
  state: GameState,
  zombie: ZombieState,
  reach: Reachability,
  targets: readonly PlayerState[],
): Position | undefined {
  let best: { distance: number; goal: Position } | undefined;
  for (const target of targets) {
    for (const goal of orthogonalNeighbours(state.map, target.position)) {
      if (!(tileAt(state.map, goal)?.walkable ?? false)) continue;
      if (positionsEqual(goal, zombie.position)) continue; // would have been an attack
      const distance = reach.distanceTo(goal);
      if (distance === undefined) continue;
      if (best === undefined || distance < best.distance) best = { distance, goal };
    }
  }
  return best?.goal;
}

/** The first tile of the shortest path to `goal`, if the zombie may stand on it now. */
function firstFreeStep(
  state: GameState,
  mover: Mover,
  reach: Reachability,
  goal: Position,
): Position | undefined {
  const first = reach.pathTo(goal)?.[0];
  return first === undefined || !canStandOn(state, first, mover) ? undefined : first;
}
