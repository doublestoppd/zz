import { chebyshevDistance, isInBounds } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState } from "../state/types.js";
import { hasLineOfSight } from "./lineOfSight.js";

/**
 * The team's current view: every tile within `rules.visionRange` (Chebyshev) of any
 * survivor still on the board, with a clear line of sight from that survivor. Sight is
 * shared: the team sees what any of its members sees. Down survivors still see; a
 * disconnected one does too, since their body is on the board. Pure and deterministic,
 * so the server and the client compute the same answer from the same snapshot.
 */
export function visibleTiles(state: GameState): Position[] {
  const seen = new Set<string>();
  const result: Position[] = [];
  const range = state.rules.visionRange;
  for (const player of state.players) {
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        const p = { x: player.position.x + dx, y: player.position.y + dy };
        const key = `${p.x},${p.y}`;
        if (seen.has(key) || !isInBounds(state.map, p)) continue;
        if (chebyshevDistance(player.position, p) > range) continue;
        if (!hasLineOfSight(state, player.position, p)) continue;
        seen.add(key);
        result.push(p);
      }
    }
  }
  return result;
}

/** Row-major grid of the current view, for cheap lookups. */
export function visibilityGrid(state: GameState): boolean[][] {
  const grid = emptyGrid(state.map.width, state.map.height);
  for (const p of visibleTiles(state)) {
    const row = grid[p.y];
    if (row !== undefined) row[p.x] = true;
  }
  return grid;
}

/** True when a tile is in the team's current view. */
export function isVisible(state: GameState, position: Position): boolean {
  return visibleTiles(state).some((p) => p.x === position.x && p.y === position.y);
}

/** Folds the current view into `explored`; explored tiles never become unexplored again. */
export function revealExplored(state: GameState): GameState {
  const visible = visibilityGrid(state);
  let changed = false;
  const explored = state.explored.map((row, y) =>
    row.map((known, x) => {
      const now = known || (visible[y]?.[x] ?? false);
      if (now !== known) changed = true;
      return now;
    }),
  );
  return changed ? { ...state, explored } : state;
}

export function emptyGrid(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => false));
}
