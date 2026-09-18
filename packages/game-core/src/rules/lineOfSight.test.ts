import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "../map/asciiMap.js";
import { hasLineOfSight, tilesBetween } from "./lineOfSight.js";

describe("tilesBetween", () => {
  it("excludes both endpoints and walks a straight line", () => {
    expect(tilesBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(tilesBetween({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([{ x: 1, y: 1 }]);
    expect(tilesBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([]);
    expect(tilesBetween({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });

  it("works in every direction", () => {
    expect(tilesBetween({ x: 3, y: 3 }, { x: 0, y: 3 })).toHaveLength(2);
    expect(tilesBetween({ x: 3, y: 3 }, { x: 3, y: 0 })).toHaveLength(2);
    expect(tilesBetween({ x: 3, y: 3 }, { x: 0, y: 0 })).toHaveLength(2);
  });
});

describe("hasLineOfSight", () => {
  const map = { ...parseAsciiMap(["......", "..#...", "......"]), barriers: [] };

  it("is clear across open floor and between adjacent tiles", () => {
    expect(hasLineOfSight(map, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    expect(hasLineOfSight(map, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
  });

  it("is blocked by a wall strictly between the endpoints", () => {
    expect(hasLineOfSight(map, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(hasLineOfSight(map, { x: 1, y: 0 }, { x: 3, y: 2 })).toBe(false);
  });

  it("is symmetric: a diagonal line that clips a wall is blocked from both ends", () => {
    const corner = { ...parseAsciiMap(["....", ".#..", "....", "...."]), barriers: [] };
    for (let y1 = 0; y1 < 4; y1 += 1) {
      for (let x1 = 0; x1 < 4; x1 += 1) {
        for (let y2 = 0; y2 < 4; y2 += 1) {
          for (let x2 = 0; x2 < 4; x2 += 1) {
            const a = { x: x1, y: y1 };
            const b = { x: x2, y: y2 };
            expect(hasLineOfSight(corner, a, b)).toBe(hasLineOfSight(corner, b, a));
          }
        }
      }
    }
  });

  it("treats positions outside the map as blocking", () => {
    expect(hasLineOfSight(map, { x: 0, y: 0 }, { x: -2, y: 0 })).toBe(false);
  });
});
