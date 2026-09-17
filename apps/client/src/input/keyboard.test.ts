import { describe, expect, it } from "vitest";
import { keyToCommand } from "./keyboard.js";
import { makeClientTestState, P1, P2 } from "./testState.js";

const state = makeClientTestState();

describe("keyToCommand", () => {
  it("moves one tile with arrows and WASD when legal", () => {
    expect(keyToCommand("ArrowRight", state, P1)).toEqual({ type: "move", to: { x: 2, y: 1 } });
    expect(keyToCommand("d", state, P1)).toEqual({ type: "move", to: { x: 2, y: 1 } });
    expect(keyToCommand("ArrowUp", state, P1)).toBeUndefined();
    expect(keyToCommand("ArrowDown", state, P1)).toBeUndefined();
  });

  it("fires at the nearest legal target, reloads, and ends the turn", () => {
    expect(keyToCommand("f", state, P1)).toEqual({ type: "fire_weapon", targetId: "z1" });
    expect(keyToCommand("R", state, P1)).toEqual({ type: "reload" });
    expect(keyToCommand("e", state, P1)).toEqual({ type: "end_turn" });
  });

  it("picks up only when standing on an item", () => {
    expect(keyToCommand("p", state, P1)).toBeUndefined();
  });

  it("does nothing off-turn or for unknown keys", () => {
    expect(keyToCommand("e", state, P2)).toBeUndefined();
    expect(keyToCommand("x", state, P1)).toBeUndefined();
  });
});
