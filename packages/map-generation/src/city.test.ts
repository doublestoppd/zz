import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "@zombie/game-core";
import { DEFAULT_CITY_OPTIONS, generateCity } from "./city.js";
import { BUILDING_TEMPLATES, rotateStamp, templateToStamp } from "./templates/buildings.js";
import { validateLayout } from "./validate/validateLayout.js";

const EXPECT = { survivorSpawns: 4, zombieSpawns: 5, lootSpawns: 3 };

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
      expect(layout.lootSpawns.every((p) => layout.map.tiles[p.y]?.[p.x]?.type === "floor")).toBe(
        true,
      );
      expect(layout.containers.length).toBeGreaterThan(0);
      // Containers sit on interior floor: every one has at least one wall neighbour.
      for (const c of layout.containers) {
        const { x, y } = c.position;
        const walls = [
          layout.map.tiles[y - 1]?.[x],
          layout.map.tiles[y + 1]?.[x],
          layout.map.tiles[y]?.[x - 1],
          layout.map.tiles[y]?.[x + 1],
        ].filter((t) => t?.type === "wall").length;
        expect(walls).toBeGreaterThan(0);
      }
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
      lootSpawns: 2,
    });
    expect(validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 3, lootSpawns: 2 }).ok).toBe(
      true,
    );
    expect(layout.map.height).toBe(14);
  });
});

describe("validateLayout", () => {
  it("reports unreachable markers and bad counts", () => {
    const layout = parseAsciiMap(["#######", "#S.#E.#", "#S.#Z.#", "#######"]);
    const result = validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 1, lootSpawns: 0 });
    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toMatch(/extraction tile \(4, 1\) unreachable/);
    expect(result.issues.join("\n")).toMatch(/zombie spawn \(4, 2\) unreachable/);
    expect(
      validateLayout(layout, { survivorSpawns: 3, zombieSpawns: 1, lootSpawns: 0 }).issues[0],
    ).toMatch(/expected 3/);
  });

  it("accepts the hand-authored fixture", () => {
    const layout = parseAsciiMap(["######", "#S.E.#", "#SLEZ#", "######"]);
    expect(validateLayout(layout, { survivorSpawns: 2, zombieSpawns: 1, lootSpawns: 1 })).toEqual({
      ok: true,
      issues: [],
    });
  });
});

describe("templates", () => {
  it("gives every template a category and at least one container", () => {
    for (const template of BUILDING_TEMPLATES) {
      expect(template.rows.some((row) => row.includes("c"))).toBe(true);
      expect(["home", "clinic", "police", "shop"]).toContain(template.category);
    }
  });

  it("rotates a stamp so the door moves around the footprint", () => {
    const stamp = templateToStamp(["###", "#c#", "#+#"]);
    expect(stamp.cells[2]?.[1]).toBe("door");
    const once = rotateStamp(stamp, 1);
    expect(once.width).toBe(3);
    expect(once.cells[1]?.[0]).toBe("door");
    expect(stamp.containers[1]?.[1]).toBe(true);
    expect(once.containers[1]?.[1]).toBe(true);
    expect(rotateStamp(stamp, 4)).toEqual(stamp);
  });
});
