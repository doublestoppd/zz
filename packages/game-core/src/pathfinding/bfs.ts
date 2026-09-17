import { orthogonalNeighbours, positionKey, tileAt } from "../map/position.js";
import type { GameMap, Position } from "../map/types.js";

/** Answers "may a mover step onto this tile?" for the caller's situation (occupancy etc.). */
export type IsPassable = (position: Position) => boolean;

interface SearchNode {
  readonly position: Position;
  readonly distance: number;
  readonly parentKey: string | undefined;
}

/**
 * Breadth-first search over walkable, passable tiles from `start`, up to `maxSteps` moves.
 * Every step costs 1, so BFS order gives shortest paths. `start` itself is always included
 * with distance 0 even if `isPassable(start)` is false (the mover is already there).
 */
function search(
  map: GameMap,
  start: Position,
  maxSteps: number,
  isPassable: IsPassable,
): Map<string, SearchNode> {
  const visited = new Map<string, SearchNode>();
  const startNode: SearchNode = { position: start, distance: 0, parentKey: undefined };
  visited.set(positionKey(start), startNode);
  // Nodes appended during iteration are visited too: array iteration is live.
  const queue: SearchNode[] = [startNode];

  for (const current of queue) {
    if (current.distance >= maxSteps) continue;
    for (const next of orthogonalNeighbours(map, current.position)) {
      const key = positionKey(next);
      if (visited.has(key)) continue;
      if (!(tileAt(map, next)?.walkable ?? false)) continue;
      if (!isPassable(next)) continue;
      const node: SearchNode = {
        position: next,
        distance: current.distance + 1,
        parentKey: positionKey(current.position),
      };
      visited.set(key, node);
      queue.push(node);
    }
  }
  return visited;
}

/** All positions reachable within `maxSteps`, excluding `start`. */
export function reachablePositions(
  map: GameMap,
  start: Position,
  maxSteps: number,
  isPassable: IsPassable,
): Position[] {
  const nodes = search(map, start, maxSteps, isPassable);
  return [...nodes.values()].filter((n) => n.distance > 0).map((n) => n.position);
}

/**
 * Shortest path from `start` to `goal` as the list of tiles stepped onto (excluding `start`,
 * including `goal`), or undefined when `goal` cannot be reached within `maxSteps`.
 */
export function findShortestPath(
  map: GameMap,
  start: Position,
  goal: Position,
  maxSteps: number,
  isPassable: IsPassable,
): Position[] | undefined {
  const nodes = search(map, start, maxSteps, isPassable);
  let node = nodes.get(positionKey(goal));
  if (node === undefined || node.distance === 0) return undefined;

  const path: Position[] = [];
  while (node?.parentKey !== undefined) {
    path.push(node.position);
    node = nodes.get(node.parentKey);
  }
  return path.reverse();
}
