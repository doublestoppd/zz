import type { GameMap, Position, Tile } from "./types.js";

export function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Stable string key for using positions in Sets/Maps inside algorithms. Not part of game state. */
export function positionKey(p: Position): string {
  return `${p.x},${p.y}`;
}

export function isInBounds(map: GameMap, p: Position): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
}

/** Returns the tile at `p`, or undefined when `p` is outside the map. */
export function tileAt(map: GameMap, p: Position): Tile | undefined {
  return map.tiles[p.y]?.[p.x];
}

/**
 * The four orthogonal neighbours that lie inside the map.
 * Movement is 4-directional; there are no diagonals (docs/GAME-RULES.md).
 */
export function orthogonalNeighbours(map: GameMap, p: Position): Position[] {
  const candidates: Position[] = [
    { x: p.x, y: p.y - 1 },
    { x: p.x + 1, y: p.y },
    { x: p.x, y: p.y + 1 },
    { x: p.x - 1, y: p.y },
  ];
  return candidates.filter((c) => isInBounds(map, c));
}
