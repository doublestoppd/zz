import { describe, expect, it } from "vitest";
import { decideClickIntent } from "./clickIntent.js";
import { keyToCommand } from "./keyboard.js";
import { makeClientTestState, P1 } from "./testState.js";

/** P1 at (1,1); a container at (2,1) (adjacent) and another at (3,2) (out of reach). */
const state = makeClientTestState(["#####", "#SC.#", "#S.C#", "#####"]);

describe("search intent", () => {
  it("clicks and the Q key search an unsearched container in reach", () => {
    expect(decideClickIntent(state, P1, { x: 2, y: 1 })).toEqual({
      type: "search",
      containerId: "c1",
    });
    expect(keyToCommand("q", state, P1)).toEqual({ type: "search", containerId: "c1" });
  });

  it("falls back to moving for a container out of reach and ignores searched ones", () => {
    expect(decideClickIntent(state, P1, { x: 3, y: 2 })).toBeUndefined(); // 3 steps, 2 AP
    const searched = {
      ...state,
      containers: state.containers.map((c) => ({ ...c, searched: true })),
    };
    expect(decideClickIntent(searched, P1, { x: 2, y: 1 })).toEqual({
      type: "move",
      to: { x: 2, y: 1 },
    });
    expect(keyToCommand("q", searched, P1)).toBeUndefined();
  });
});
