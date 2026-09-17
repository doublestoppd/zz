import { tileAt } from "../map/position.js";
import type { GameMap, Position } from "../map/types.js";

/**
 * The tiles a straight line from `from` to `to` passes through, excluding both endpoints,
 * using Bresenham's algorithm on tile centres. Deterministic and symmetric enough for a
 * tile game; entities never block sight, only tiles with `blocksVision` do.
 */
export function tilesBetween(from: Position, to: Position): Position[] {
  const tiles: Position[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  let x = from.x;
  let y = from.y;

  for (;;) {
    if (x === to.x && y === to.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
    if (x === to.x && y === to.y) break;
    tiles.push({ x, y });
  }
  return tiles;
}

/** True when no tile strictly between the two positions blocks vision. */
export function hasLineOfSight(map: GameMap, from: Position, to: Position): boolean {
  return tilesBetween(from, to).every((p) => !(tileAt(map, p)?.blocksVision ?? true));
}
