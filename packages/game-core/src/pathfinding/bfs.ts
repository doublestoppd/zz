import type { GameMap, Position } from "../map/types.js";

/** Answers "may a mover step onto this tile?" for the caller's situation (occupancy etc.). */
export type IsPassable = (position: Position) => boolean;

/**
 * One search's results as flat arrays indexed by `y * width + x`: distance from the start
 * (-1 when unreached) and the parent index (-1 at the start), plus the indices in the
 * order they were reached. Typed arrays because the search is the hot loop of the zombie
 * phase (docs/PERFORMANCE.md); the visiting order is the same as before (up, right, down,
 * left from each tile in BFS order), so every path and tie is unchanged.
 */
interface SearchResult {
  readonly width: number;
  readonly distance: Int32Array;
  readonly parent: Int32Array;
  readonly order: Int32Array;
  readonly reached: number;
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
): SearchResult {
  const { width, height } = map;
  const size = width * height;
  const distance = new Int32Array(size).fill(-1);
  const parent = new Int32Array(size).fill(-1);
  const order = new Int32Array(size);
  const startIndex = start.y * width + start.x;
  distance[startIndex] = 0;
  order[0] = startIndex;
  let reached = 1;
  let head = 0;
  const probe: { x: number; y: number } = { x: 0, y: 0 };
  while (head < reached) {
    const current = order[head] ?? -1;
    head += 1;
    const d = distance[current] ?? -1;
    if (d >= maxSteps) continue;
    const cx = current % width;
    const cy = (current - cx) / width;
    // Up, right, down, left: the order `orthogonalNeighbours` uses.
    for (let side = 0; side < 4; side += 1) {
      const nx = side === 1 ? cx + 1 : side === 3 ? cx - 1 : cx;
      const ny = side === 0 ? cy - 1 : side === 2 ? cy + 1 : cy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (distance[next] !== -1) continue;
      if (map.tiles[ny]?.[nx]?.walkable !== true) continue;
      probe.x = nx;
      probe.y = ny;
      if (!isPassable(probe)) continue;
      distance[next] = d + 1;
      parent[next] = current;
      order[reached] = next;
      reached += 1;
    }
  }
  return { width, distance, parent, order, reached };
}

function positionOf(result: SearchResult, index: number): Position {
  const x = index % result.width;
  return { x, y: (index - x) / result.width };
}

function indexOf(result: SearchResult, map: GameMap, p: Position): number | undefined {
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return undefined;
  return p.y * result.width + p.x;
}

/**
 * The result of one search, reusable for many goals (a zombie choosing between targets).
 * `distanceTo` is undefined for unreachable positions; `pathTo` matches `findShortestPath`.
 */
export interface Reachability {
  distanceTo(goal: Position): number | undefined;
  pathTo(goal: Position): Position[] | undefined;
}

export function searchFrom(
  map: GameMap,
  start: Position,
  maxSteps: number,
  isPassable: IsPassable,
): Reachability {
  const result = search(map, start, maxSteps, isPassable);
  return {
    distanceTo: (goal) => {
      const index = indexOf(result, map, goal);
      if (index === undefined) return undefined;
      const d = result.distance[index] ?? -1;
      return d === -1 ? undefined : d;
    },
    pathTo: (goal) => pathFromResult(result, map, goal),
  };
}

function pathFromResult(
  result: SearchResult,
  map: GameMap,
  goal: Position,
): Position[] | undefined {
  let index = indexOf(result, map, goal);
  if (index === undefined) return undefined;
  const d = result.distance[index] ?? -1;
  if (d <= 0) return undefined;
  const path: Position[] = new Array<Position>(d);
  for (let i = d - 1; i >= 0; i -= 1) {
    path[i] = positionOf(result, index);
    index = result.parent[index] ?? -1;
  }
  return path;
}

/** All positions reachable within `maxSteps`, excluding `start`, in the order they were reached. */
export function reachablePositions(
  map: GameMap,
  start: Position,
  maxSteps: number,
  isPassable: IsPassable,
): Position[] {
  const result = search(map, start, maxSteps, isPassable);
  const positions: Position[] = [];
  for (let i = 1; i < result.reached; i += 1) {
    positions.push(positionOf(result, result.order[i] ?? 0));
  }
  return positions;
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
  return pathFromResult(search(map, start, maxSteps, isPassable), map, goal);
}
