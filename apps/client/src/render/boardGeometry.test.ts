import { describe, expect, it } from "vitest";
import { pixelToTile, TILE_SIZE, tileCenter, tileToPixel } from "./boardGeometry.js";

describe("boardGeometry", () => {
  it("round-trips a tile through its centre pixel", () => {
    const tile = { x: 3, y: 7 };
    expect(pixelToTile(tileCenter(tile))).toEqual(tile);
  });

  it("maps the top-left pixel of a tile onto that tile and the pixel before it onto the previous one", () => {
    expect(pixelToTile(tileToPixel({ x: 2, y: 1 }))).toEqual({ x: 2, y: 1 });
    expect(pixelToTile({ x: 2 * TILE_SIZE - 1, y: TILE_SIZE })).toEqual({ x: 1, y: 1 });
  });

  it("produces negative tiles for pixels left of or above the board", () => {
    expect(pixelToTile({ x: -1, y: -1 })).toEqual({ x: -1, y: -1 });
  });
});
