import { describe, expect, it } from "vitest";
import { playerId } from "../ids.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { applyCommand } from "./applyCommand.js";
import type { Command } from "./types.js";

describe("applyCommand: shared turn checks", () => {
  it("rejects commands from a player who is not active", () => {
    const state = makeTestState({ players: [P1, P2] });
    expect(applyCommand(state, { type: "end_turn", playerId: P2 })).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
  });

  it("rejects unknown players", () => {
    const state = makeTestState();
    expect(applyCommand(state, { type: "end_turn", playerId: playerId("ghost") })).toEqual({
      ok: false,
      reason: "UNKNOWN_PLAYER",
    });
  });

  it("rejects commands outside a player turn and after the match ends", () => {
    const base = makeTestState();
    const zombie: GameState = { ...base, phase: { kind: "zombie_phase" } };
    expect(applyCommand(zombie, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "WRONG_PHASE",
    });
    const finished: GameState = { ...base, phase: { kind: "finished", outcome: "defeat" } };
    expect(applyCommand(finished, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "MATCH_FINISHED",
    });
  });
});

describe("applyCommand: move", () => {
  it("moves the player, deducts action points, and emits player_moved", () => {
    const state = makeTestState({ maxActionPoints: 4 });
    const result = applyCommand(state, { type: "move", playerId: P1, to: { x: 3, y: 1 } });
    if (!result.ok) throw new Error(result.reason);
    const p1 = findPlayer(result.state, P1)!;
    expect(p1.position).toEqual({ x: 3, y: 1 });
    expect(p1.actionPoints).toBe(2);
    expect(result.events).toEqual([
      {
        type: "player_moved",
        playerId: P1,
        path: [
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
        actionPointsSpent: 2,
      },
    ]);
  });

  it("leaves the turn with the player after a move, even at zero action points", () => {
    const state = makeTestState({ maxActionPoints: 2 });
    const result = applyCommand(state, { type: "move", playerId: P1, to: { x: 3, y: 1 } });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.phase).toEqual({ kind: "player_turn", activePlayerId: P1 });
    expect(findPlayer(result.state, P1)?.actionPoints).toBe(0);
  });

  it("does not modify the input state", () => {
    const state = makeTestState();
    const snapshot = structuredClone(state);
    applyCommand(state, { type: "move", playerId: P1, to: { x: 2, y: 1 } });
    expect(state).toEqual(snapshot);
  });
});

describe("applyCommand: end_turn", () => {
  it("settles through the non-player phases when the last player ends their turn", () => {
    const state = makeTestState({ players: [P1] });
    const result = applyCommand(state, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.round).toBe(2);
    expect(result.state.phase).toEqual({ kind: "player_turn", activePlayerId: P1 });
  });
});

describe("determinism", () => {
  it("replays the same command sequence to an identical state", () => {
    const commands: Command[] = [
      { type: "move", playerId: P1, to: { x: 2, y: 1 } },
      { type: "end_turn", playerId: P1 },
      { type: "move", playerId: P2, to: { x: 2, y: 2 } },
      { type: "end_turn", playerId: P2 },
      { type: "move", playerId: P1, to: { x: 4, y: 1 } },
    ];
    const run = (): GameState =>
      commands.reduce(
        (s, c) => {
          const r = applyCommand(s, c);
          if (!r.ok) throw new Error(r.reason);
          return r.state;
        },
        makeTestState({ seed: 7 }),
      );
    expect(run()).toEqual(run());
    expect(JSON.parse(JSON.stringify(run()))).toEqual(run());
  });
});
