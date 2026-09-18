import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "./asciiMap.js";
import { SMALL_TEST_MAP } from "./testMaps.js";

describe("parseAsciiMap", () => {
  it("builds tiles, spawns, and the extraction zone from the legend", () => {
    const layout = parseAsciiMap(["#SC", "Z#E"]);
    expect(layout.map.width).toBe(3);
    expect(layout.map.height).toBe(2);
    expect(layout.map.tiles[0]?.[0]?.walkable).toBe(false);
    expect(layout.map.tiles[1]?.[0]?.walkable).toBe(true);
    expect(layout.zombieSpawns).toEqual([{ x: 0, y: 1 }]);
    expect(layout.containers).toEqual([{ position: { x: 2, y: 0 }, category: "home" }]);
    expect(layout.map.tiles[0]?.[1]?.walkable).toBe(true);
    expect(layout.spawnPositions).toEqual([{ x: 1, y: 0 }]);
    expect(layout.extractionZone).toEqual([{ x: 2, y: 1 }]);
  });

  it("turns door and window symbols into barriers with their starting state", () => {
    const layout = parseAsciiMap(["+OKW"]);
    expect(layout.map.tiles[0]?.map((t) => t.type)).toEqual(["door", "door", "door", "window"]);
    expect(layout.barriers).toEqual([
      { position: { x: 0, y: 0 }, kind: "door", state: "closed" },
      { position: { x: 1, y: 0 }, kind: "door", state: "open" },
      { position: { x: 2, y: 0 }, kind: "door", state: "locked" },
      { position: { x: 3, y: 0 }, kind: "window", state: "closed" },
    ]);
  });

  it("rejects ragged rows and unknown symbols", () => {
    expect(() => parseAsciiMap(["##", "#"])).toThrow(/row 1/);
    expect(() => parseAsciiMap(["#?"])).toThrow(/unknown symbol/);
    expect(() => parseAsciiMap([])).toThrow();
  });

  it("ships a fixture with four spawns, an extraction zone, and zombies", () => {
    expect(SMALL_TEST_MAP.spawnPositions).toHaveLength(4);
    expect(SMALL_TEST_MAP.extractionZone.length).toBeGreaterThan(0);
    expect(SMALL_TEST_MAP.zombieSpawns).toHaveLength(3);
    expect(SMALL_TEST_MAP.lootSpawns).toHaveLength(2);
    expect(SMALL_TEST_MAP.containers).toHaveLength(1);
  });
});
