import { describe, expect, it } from "vitest";
import { createInitialState, matchId, parseAsciiMap, playerId } from "@zombie/game-core";
import { decideMoveIntent } from "./moveIntent.js";

const P1 = playerId("p1");
const P2 = playerId("p2");
const state = createInitialState({
  matchId: matchId("m"),
  seed: 1,
  rules: { moveCostPerTile: 1 },
  survivor: { maxHealth: 10, maxActionPoints: 2 },
  layout: parseAsciiMap(["#####", "#S..#", "#S..#", "#####"]),
  players: [
    { id: P1, name: "one" },
    { id: P2, name: "two" },
  ],
});

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
