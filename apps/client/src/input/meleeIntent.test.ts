import { describe, expect, it } from "vitest";
import { decideClickIntent } from "./clickIntent.js";
import { keyToCommand } from "./keyboard.js";
import { makeClientTestState, P1 } from "./testState.js";

/** P1 at (1,1) with z1 adjacent at (2,1) and z2 at (4,2), in range but not adjacent. */
const state = makeClientTestState(["######", "#SZ..#", "#S..Z#", "######"]);

describe("melee intent", () => {
  it("V strikes the nearest adjacent zombie; F still fires at the nearest in range", () => {
    expect(keyToCommand("v", state, P1)).toEqual({ type: "melee_attack", targetId: "z1" });
    expect(keyToCommand("f", state, P1)).toEqual({ type: "fire_weapon", targetId: "z1" });
  });

  it("a click strikes only when a shot is impossible", () => {
    expect(decideClickIntent(state, P1, { x: 2, y: 1 })).toEqual({
      type: "fire_weapon",
      targetId: "z1",
    });
    const empty = {
      ...state,
      players: state.players.map((p) => ({ ...p, weapon: { ...p.weapon, loadedAmmo: 0 } })),
    };
    expect(decideClickIntent(empty, P1, { x: 2, y: 1 })).toEqual({
      type: "melee_attack",
      targetId: "z1",
    });
    expect(decideClickIntent(empty, P1, { x: 4, y: 2 })).toBeUndefined();
    expect(keyToCommand("f", empty, P1)).toBeUndefined();
  });
});
