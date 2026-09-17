import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findShortestPath, reachablePositions } from "./bfs.js";

const { map } = parseAsciiMap(["#####", "#...#", "#.#.#", "#...#", "#####"]);
const passable = (): boolean => true;

describe("findShortestPath", () => {
  it("routes around walls with the fewest steps", () => {
    const path = findShortestPath(map, { x: 1, y: 2 }, { x: 3, y: 2 }, 99, passable);
    expect(path).toHaveLength(4);
    expect(path?.at(-1)).toEqual({ x: 3, y: 2 });
  });

  it("returns undefined when the goal is beyond maxSteps or blocked", () => {
    expect(findShortestPath(map, { x: 1, y: 2 }, { x: 3, y: 2 }, 3, passable)).toBeUndefined();
    expect(findShortestPath(map, { x: 1, y: 1 }, { x: 2, y: 2 }, 99, passable)).toBeUndefined();
  });

  it("returns undefined for the start position itself", () => {
    expect(findShortestPath(map, { x: 1, y: 1 }, { x: 1, y: 1 }, 99, passable)).toBeUndefined();
  });

  it("treats impassable positions as walls but never blocks the start", () => {
    const blocked = (p: { x: number; y: number }): boolean => !(p.x === 2 && p.y === 1);
    const path = findShortestPath(map, { x: 1, y: 1 }, { x: 3, y: 1 }, 99, blocked);
    expect(path).toHaveLength(6);
    const fromBlocked = findShortestPath(map, { x: 2, y: 1 }, { x: 3, y: 1 }, 99, blocked);
    expect(fromBlocked).toEqual([{ x: 3, y: 1 }]);
  });
});

describe("reachablePositions", () => {
  it("lists every tile within range, excluding the origin", () => {
    const reach = reachablePositions(map, { x: 1, y: 1 }, 1, passable);
    expect(reach).toEqual(
      expect.arrayContaining([
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ]),
    );
    expect(reach).toHaveLength(2);
  });
});
