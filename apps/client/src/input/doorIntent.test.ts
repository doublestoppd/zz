import { describe, expect, it } from "vitest";
import { decideClickIntent } from "./clickIntent.js";
import { keyToCommand } from "./keyboard.js";
import { makeClientTestState, P1 } from "./testState.js";

/** P1 at (1,1) beside a closed door at (2,1); P2 at (1,2) beside a window at (2,2). */
const state = makeClientTestState(["#####", "#S+.#", "#SW.#", "#####"]);
const withDoor = (doorState: "open" | "locked") => ({
  ...state,
  barriers: state.barriers.map((b) => (b.kind === "door" ? { ...b, state: doorState } : b)),
});

describe("door intent", () => {
  it("clicks and the O key open a closed door in reach", () => {
    expect(decideClickIntent(state, P1, { x: 2, y: 1 })).toEqual({
      type: "open_door",
      barrierId: "b1",
    });
    expect(keyToCommand("o", state, P1)).toEqual({ type: "open_door", barrierId: "b1" });
    expect(keyToCommand("c", state, P1)).toBeUndefined();
    expect(keyToCommand("x", state, P1)).toBeUndefined();
  });

  it("treats an open door as floor and closes it with the C key", () => {
    const open = withDoor("open");
    expect(decideClickIntent(open, P1, { x: 2, y: 1 })).toEqual({
      type: "move",
      to: { x: 2, y: 1 },
    });
    expect(keyToCommand("c", open, P1)).toEqual({ type: "close_door", barrierId: "b1" });
    expect(keyToCommand("o", open, P1)).toBeUndefined();
  });

  it("still asks to open a locked door on click, and forces it with X", () => {
    const locked = withDoor("locked");
    expect(decideClickIntent(locked, P1, { x: 2, y: 1 })).toEqual({
      type: "open_door",
      barrierId: "b1",
    });
    expect(keyToCommand("o", locked, P1)).toBeUndefined();
    expect(keyToCommand("x", locked, P1)).toEqual({ type: "force_entry", barrierId: "b1" });
    const withKey = {
      ...locked,
      players: locked.players.map((p) => (p.id === P1 ? { ...p, inventory: ["key" as const] } : p)),
    };
    expect(keyToCommand("o", withKey, P1)).toEqual({ type: "open_door", barrierId: "b1" });
  });

  it("never opens a window by click; it is out of P1's reach anyway", () => {
    expect(decideClickIntent(state, P1, { x: 2, y: 2 })).toBeUndefined();
  });
});
