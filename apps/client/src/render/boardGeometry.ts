import type { Position } from "@zombie/game-core";

/** Pixel size of one tile. The only place this number lives on the client. */
export const TILE_SIZE = 40;

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

/** Top-left pixel of a tile. */
export function tileToPixel(tile: Position): Pixel {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/** Centre pixel of a tile, where sprites and labels are placed. */
export function tileCenter(tile: Position): Pixel {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

/** The tile under a pixel; may be outside the map, callers bounds-check against the state. */
export function pixelToTile(pixel: Pixel): Position {
  return { x: Math.floor(pixel.x / TILE_SIZE), y: Math.floor(pixel.y / TILE_SIZE) };
}
