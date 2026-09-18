import { tileAt } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState } from "../state/types.js";
import { barrierAt, barrierBlocksVision } from "../state/barriers.js";

/** What sight is computed over: the terrain and the doors standing in it. */
export type VisionBoard = Pick<GameState, "map" | "barriers">;

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

function blocksVision(board: VisionBoard, p: Position): boolean {
  if (tileAt(board.map, p)?.blocksVision ?? true) return true;
  const barrier = barrierAt(board, p);
  return barrier !== undefined && barrierBlocksVision(barrier);
}

function isClear(board: VisionBoard, from: Position, to: Position): boolean {
  return tilesBetween(from, to).every((p) => !blocksVision(board, p));
}

/**
 * True when no tile strictly between the two positions blocks vision: walls always do,
 * closed and locked doors do, windows and open or broken barriers never do. Bresenham
 * lines are not symmetric, so both directions are checked and sight exists only when both
 * are clear; cover therefore never depends on who is looking.
 */
export function hasLineOfSight(board: VisionBoard, from: Position, to: Position): boolean {
  return isClear(board, from, to) && isClear(board, to, from);
}
