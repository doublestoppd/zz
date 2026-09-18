import { parseAsciiMap } from "@zombie/game-core";
import { describe, expect, it } from "vitest";
import { assetManifest, variant } from "./assets.js";
import { outdoorGrid } from "./outdoors.js";
import { SAMPLES, sampleUrl } from "../audio/samples.js";

describe("asset manifest", () => {
  it("names every file once and every file exists under public/", () => {
    const entries = assetManifest();
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Vite resolves the glob at build time, so the check needs no file system access.
    const files = Object.keys(import.meta.glob("../../public/assets/kenney/**/*.png"));
    const present = new Set(files.map((f) => f.replace("../../public", "")));
    for (const entry of entries) {
      expect(present.has(entry.url), entry.url).toBe(true);
    }
    expect(entries.length).toBeGreaterThan(50);
  });

  it("picks tile variants deterministically", () => {
    const keys = ["a", "b", "c"] as const;
    expect(variant(keys, 3, 4)).toBe(variant(keys, 3, 4));
    const seen = new Set<string>();
    for (let x = 0; x < 10; x += 1) for (let y = 0; y < 10; y += 1) seen.add(variant(keys, x, y));
    expect(seen.size).toBe(3);
  });
});

describe("outdoorGrid", () => {
  it("marks tiles reachable from the edge without crossing walls, doors, or windows", () => {
    const layout = parseAsciiMap(["S.......", "..####..", "..#..+..", "..####..", "........"]);
    const grid = outdoorGrid(layout.map);
    expect(grid[0]?.[0]).toBe(true);
    expect(grid[4]?.[7]).toBe(true);
    // A walled city: only the road seeds the outdoors, and the lot beside it follows.
    const walled = parseAsciiMap(["#########", "#S=..#.##", "#..=.#+##", "#########"]);
    const inner = outdoorGrid(walled.map);
    expect(inner[1]?.[3]).toBe(true); // lot next to the road
    expect(inner[1]?.[6]).toBe(false); // room behind the wall
    expect(grid[2]?.[3]).toBe(false); // inside the shell
    expect(grid[2]?.[5]).toBe(false); // the door itself is a threshold, not outdoors
    expect(grid[1]?.[2]).toBe(false); // walls are never outdoors
  });
});

describe("sound samples", () => {
  it("point at files that exist under public/", () => {
    const files = Object.keys(import.meta.glob("../../public/assets/kenney/audio/*.ogg"));
    const present = new Set(files.map((f) => f.replace("../../public", "")));
    for (const list of Object.values(SAMPLES)) {
      for (const file of list) expect(present.has(sampleUrl(file)), file).toBe(true);
    }
  });
});
