import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "../map/asciiMap.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { decideZombieAction } from "./targetSelection.js";

/** P1 at (1,1), P2 at (1,2), zombie at (5,1) in an open room. */
const OPEN = parseAsciiMap(["#######", "#S...Z#", "#S....#", "#######"]);

function zombie(state: GameState) {
  const z = state.zombies[0];
  if (z === undefined) throw new Error("no zombie");
  return z;
}

describe("decideZombieAction", () => {
  it("steps one tile along the shortest path toward the nearest survivor", () => {
    const state = makeTestState({ players: [P1, P2], layout: OPEN });
    expect(decideZombieAction(state, zombie(state))).toMatchObject({
      kind: "step",
      to: { x: 4, y: 1 },
    });
  });

  it("attacks when a survivor is orthogonally adjacent", () => {
    const base = makeTestState({ players: [P1], layout: OPEN });
    const state: GameState = {
      ...base,
      zombies: [{ ...zombie(base), position: { x: 2, y: 1 } }],
    };
    expect(decideZombieAction(state, zombie(state))).toMatchObject({
      kind: "attack",
      target: { id: P1 },
    });
  });

  it("ignores down survivors and waits when nobody is reachable", () => {
    const base = makeTestState({ players: [P1], layout: OPEN });
    const allDown: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, status: "down", health: 0 })),
    };
    expect(decideZombieAction(allDown, zombie(allDown))).toMatchObject({ kind: "wait" });

    const sealed = parseAsciiMap(["#######", "#S#..Z#", "#######"]);
    const walled = makeTestState({ players: [P1], layout: sealed });
    expect(decideZombieAction(walled, zombie(walled))).toMatchObject({ kind: "wait" });
  });

  it("breaks distance ties by turn order", () => {
    // Zombie at (3,1); P1 at (1,1) and P2 at (5,1) are both two tiles away.
    const layout = parseAsciiMap(["#######", "#S.Z.S#", "#######"]);
    const state = makeTestState({ players: [P1, P2], layout });
    expect(decideZombieAction(state, zombie(state))).toMatchObject({
      kind: "step",
      to: { x: 2, y: 1 },
      reason: "pursue",
    });
  });

  it("never steps onto a tile another zombie occupies", () => {
    // Corridor: P1, gap, zombie A, zombie B behind it. Seen on the same board, B must wait.
    const layout = parseAsciiMap(["######", "#S.ZZ#", "######"]);
    const state = makeTestState({ players: [P1], layout });
    const [a, b] = state.zombies;
    expect(decideZombieAction(state, a!)).toMatchObject({ kind: "step", to: { x: 2, y: 1 } });
    expect(decideZombieAction(state, b!)).toMatchObject({ kind: "wait" });
  });
});
