import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "./asciiMap.js";
import { SMALL_TEST_MAP } from "./testMaps.js";

describe("parseAsciiMap", () => {
  it("builds tiles, spawns, and the extraction zone from the legend", () => {
    const layout = parseAsciiMap(["#S.", ".#E"]);
    expect(layout.map.width).toBe(3);
    expect(layout.map.height).toBe(2);
    expect(layout.map.tiles[0]?.[0]?.walkable).toBe(false);
    expect(layout.map.tiles[0]?.[1]?.walkable).toBe(true);
    expect(layout.spawnPositions).toEqual([{ x: 1, y: 0 }]);
    expect(layout.extractionZone).toEqual([{ x: 2, y: 1 }]);
  });

  it("rejects ragged rows and unknown symbols", () => {
    expect(() => parseAsciiMap(["##", "#"])).toThrow(/row 1/);
    expect(() => parseAsciiMap(["#?"])).toThrow(/unknown symbol/);
    expect(() => parseAsciiMap([])).toThrow();
  });

  it("ships a fixture with four spawns and an extraction zone", () => {
    expect(SMALL_TEST_MAP.spawnPositions).toHaveLength(4);
    expect(SMALL_TEST_MAP.extractionZone.length).toBeGreaterThan(0);
  });
});
