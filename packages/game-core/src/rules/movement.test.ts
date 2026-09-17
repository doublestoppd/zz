import { describe, expect, it } from "vitest";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { legalMoveDestinations, validateMove } from "./movement.js";

function p1(state = makeTestState()) {
  return { state, player: findPlayer(state, P1)! };
}

describe("validateMove", () => {
  it("accepts a reachable destination and reports the path and cost", () => {
    const { state, player } = p1();
    const result = validateMove(state, player, { x: 3, y: 1 });
    expect(result).toEqual({
      ok: true,
      path: [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
      cost: 2,
    });
  });

  it("rejects destinations outside the map", () => {
    const { state, player } = p1();
    expect(validateMove(state, player, { x: -1, y: 0 })).toEqual({
      ok: false,
      reason: "DESTINATION_OUT_OF_BOUNDS",
    });
  });

  it("rejects walls", () => {
    const { state, player } = p1();
    expect(validateMove(state, player, { x: 3, y: 2 })).toEqual({
      ok: false,
      reason: "DESTINATION_BLOCKED",
    });
  });

  it("rejects the player's own tile", () => {
    const { state, player } = p1();
    expect(validateMove(state, player, player.position)).toEqual({
      ok: false,
      reason: "DESTINATION_IS_CURRENT_POSITION",
    });
  });

  it("rejects tiles occupied by another player", () => {
    const { state, player } = p1();
    const other = findPlayer(state, P2)!;
    expect(validateMove(state, player, other.position)).toEqual({
      ok: false,
      reason: "DESTINATION_OCCUPIED",
    });
  });

  it("rejects destinations that cost more action points than the player has", () => {
    const { state, player } = p1(makeTestState({ maxActionPoints: 2 }));
    expect(validateMove(state, player, { x: 4, y: 1 })).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });

  it("charges moveCostPerTile per step", () => {
    const { state, player } = p1(makeTestState({ maxActionPoints: 4, moveCostPerTile: 2 }));
    const result = validateMove(state, player, { x: 3, y: 1 });
    expect(result).toMatchObject({ ok: true, cost: 4 });
    expect(validateMove(state, player, { x: 4, y: 1 })).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });

  it("routes around other players rather than through them", () => {
    // P2 stands at (1,2), directly below P1 at (1,1). Reaching (1,3) must go around P2 via x=2.
    const { state, player } = p1(makeTestState({ players: [P1, P2], maxActionPoints: 10 }));
    const result = validateMove(state, player, { x: 1, y: 3 });
    expect(result).toMatchObject({ ok: true, cost: 4 });
  });

  it("reports unreachable destinations distinctly from unaffordable ones", () => {
    const sealed = parseAsciiMap(["#####", "#S#.#", "#####"]);
    const { state, player } = p1(makeTestState({ players: [P1], layout: sealed }));
    expect(validateMove(state, player, { x: 3, y: 1 })).toEqual({
      ok: false,
      reason: "DESTINATION_UNREACHABLE",
    });
  });
});

describe("legalMoveDestinations", () => {
  it("returns exactly the tiles reachable with current action points", () => {
    const state = makeTestState({ players: [P1], maxActionPoints: 1 });
    expect(legalMoveDestinations(state, P1)).toEqual(
      expect.arrayContaining([
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ]),
    );
    expect(legalMoveDestinations(state, P1)).toHaveLength(2);
  });

  it("returns nothing for unknown players", () => {
    expect(legalMoveDestinations(makeTestState(), P2)).not.toHaveLength(0);
    expect(legalMoveDestinations(makeTestState({ players: [P1] }), P2)).toEqual([]);
  });
});
