import { describe, expect, it } from "vitest";
import { decideMoveIntent } from "./moveIntent.js";
import { makeClientTestState, P1, P2 } from "./testState.js";

const state = makeClientTestState(["#####", "#S..#", "#S..#", "#####"]);

describe("decideMoveIntent", () => {
  it("returns a move for a reachable tile on my turn", () => {
    expect(decideMoveIntent(state, P1, { x: 3, y: 1 })).toEqual({
      type: "move",
      to: { x: 3, y: 1 },
    });
  });

  it("returns nothing for walls, occupied tiles, out-of-range tiles, or when it is not my turn", () => {
    expect(decideMoveIntent(state, P1, { x: 0, y: 0 })).toBeUndefined();
    expect(decideMoveIntent(state, P1, { x: 1, y: 2 })).toBeUndefined();
    expect(decideMoveIntent(state, P1, { x: 3, y: 2 })).toBeUndefined();
    expect(decideMoveIntent(state, P2, { x: 3, y: 2 })).toBeUndefined();
  });
});
