import { describe, expect, it } from "vitest";
import { decideClickIntent } from "./clickIntent.js";
import { makeClientTestState, P1, P2 } from "./testState.js";

const state = makeClientTestState();

describe("decideClickIntent", () => {
  it("fires at a zombie in range on my turn", () => {
    expect(decideClickIntent(state, P1, { x: 3, y: 2 })).toEqual({
      type: "fire_weapon",
      targetId: "z1",
    });
  });

  it("moves to an empty reachable tile", () => {
    expect(decideClickIntent(state, P1, { x: 2, y: 1 })).toEqual({
      type: "move",
      to: { x: 2, y: 1 },
    });
  });

  it("returns nothing off-turn or for illegal tiles", () => {
    expect(decideClickIntent(state, P2, { x: 3, y: 2 })).toBeUndefined();
    expect(decideClickIntent(state, P1, { x: 0, y: 0 })).toBeUndefined();
  });
});
