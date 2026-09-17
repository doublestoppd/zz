import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "@zombie/game-core";
import { DEFAULT_CITY_OPTIONS, generateCity } from "./city.js";
import { rotateStamp, templateToStamp } from "./templates/buildings.js";
import { validateLayout } from "./validate/validateLayout.js";

const EXPECT = { survivorSpawns: 4, zombieSpawns: 5 };

describe("generateCity", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 42 });
    const b = generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 42 });
    const c = generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 43 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("produces valid layouts for many seeds", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const layout = generateCity({ ...DEFAULT_CITY_OPTIONS, seed });
      const result = validateLayout(layout, EXPECT);
      expect(result.issues, `seed ${seed}`).toEqual([]);
      expect(layout.map.width).toBe(DEFAULT_CITY_OPTIONS.width);
      expect(layout.extractionZone).toHaveLength(4);
    }
  });

  it("surrounds the map with walls and includes roads, buildings, and doors", () => {
    const { map } = generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 7 });
    const types = new Set(map.tiles.flat().map((t) => t.type));
    expect(types).toEqual(new Set(["floor", "road", "door", "wall"]));
    expect(map.tiles[0]?.every((t) => t.type === "wall")).toBe(true);
    expect(map.tiles.every((row) => row[0]?.type === "wall" && row.at(-1)?.type === "wall")).toBe(
      true,
    );
  });

  it("places the extraction zone far from the survivors", () => {
    const layout = generateCity({ ...DEFAULT_CITY_OPTIONS, seed: 11 });
    const spawn = layout.spawnPositions[0]!;
    const zone = layout.extractionZone[0]!;
    expect(Math.abs(zone.x - spawn.x) + Math.abs(zone.y - spawn.y)).toBeGreaterThan(10);
  });

  it("honours custom sizes and counts", () => {
    const layout = generateCity({
      seed: 3,
      width: 20,
      height: 14,
      survivorSpawns: 2,
      zombieSpawns: 3,
    });
    expect(validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 3 }).ok).toBe(true);
    expect(layout.map.height).toBe(14);
  });
});

describe("validateLayout", () => {
  it("reports unreachable markers and bad counts", () => {
    const layout = parseAsciiMap(["#######", "#S.#E.#", "#S.#Z.#", "#######"]);
    const result = validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 1 });
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toMatch(/extraction tile \(4, 1\) unreachable/);
    expect(result.issues.join("\n")).toMatch(/zombie spawn \(4, 2\) unreachable/);
    expect(validateLayout(layout, { survivorSpawns: 3, zombieSpawns: 1 }).issues[0]).toMatch(
      /expected 3/,
    );
  });

  it("accepts the hand-authored fixture", () => {
    const layout = parseAsciiMap(["######", "#S.E.#", "#S.EZ#", "######"]);
    expect(validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 1 })).toEqual({
      ok: true,
      issues: [],
    });
  });
});

describe("templates", () => {
  it("rotates a stamp so the door moves around the footprint", () => {
    const stamp = templateToStamp(["###", "#.#", "#+#"]);
    expect(stamp.cells[2]?.[1]).toBe("door");
    const once = rotateStamp(stamp, 1);
    expect(once.width).toBe(3);
    expect(once.cells[1]?.[0]).toBe("door");
    expect(rotateStamp(stamp, 4)).toEqual(stamp);
  });
});
