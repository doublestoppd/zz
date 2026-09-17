import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "../map/asciiMap.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { canStandOn, passabilityFor } from "./occupancy.js";

/** P1 (1,1), P2 (1,2), zombies z1 (3,1) and z2 (4,1). */
const state = makeTestState({
  players: [P1, P2],
  layout: parseAsciiMap(["######", "#S.ZZ#", "#S...#", "######"]),
});
const z1 = state.zombies[0]!;

describe("passabilityFor", () => {
  it("lets a survivor pass only empty tiles, never other survivors or zombies", () => {
    const passable = passabilityFor(state, { kind: "survivor", id: P1 });
    expect(passable({ x: 2, y: 1 })).toBe(true);
    expect(passable({ x: 1, y: 2 })).toBe(false);
    expect(passable({ x: 3, y: 1 })).toBe(false);
    expect(passable({ x: 1, y: 1 })).toBe(true); // its own tile
  });

  it("lets a zombie plan through other zombies but not through survivors", () => {
    const passable = passabilityFor(state, { kind: "zombie", id: z1.id });
    expect(passable({ x: 4, y: 1 })).toBe(true);
    expect(passable({ x: 1, y: 1 })).toBe(false);
  });

  it("never lets anyone finish a move on an occupied tile", () => {
    expect(canStandOn(state, { x: 4, y: 1 }, { kind: "zombie", id: z1.id })).toBe(false);
    expect(canStandOn(state, { x: 2, y: 1 }, { kind: "zombie", id: z1.id })).toBe(true);
    expect(canStandOn(state, { x: 1, y: 2 }, { kind: "survivor", id: P1 })).toBe(false);
  });
});
