import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2, P3 } from "../testing/makeTestState.js";
import { advanceUntilPlayerInput, endActiveTurn, resolveEndOfRound } from "./phases.js";

function activeId(state: GameState) {
  return state.phase.kind === "player_turn" ? state.phase.activePlayerId : undefined;
}

describe("endActiveTurn", () => {
  it("passes the turn to the next player in order", () => {
    const state = makeTestState({ players: [P1, P2, P3] });
    const { state: next, events } = endActiveTurn(state);
    expect(activeId(next)).toBe(P2);
    expect(events.map((e) => e.type)).toEqual(["turn_ended", "phase_changed", "turn_started"]);
  });

  it("skips absent players", () => {
    const state = makeTestState({ players: [P1, P2, P3] });
    const withP2Absent = applyCommand(state, {
      type: "set_player_presence",
      playerId: P2,
      present: false,
    });
    if (!withP2Absent.ok) throw new Error(withP2Absent.reason);
    expect(activeId(endActiveTurn(withP2Absent.state).state)).toBe(P3);
  });

  it("moves to the zombie phase after the last eligible player", () => {
    const state = makeTestState({ players: [P1, P2] });
    const afterP1 = endActiveTurn(state).state;
    const afterP2 = endActiveTurn(afterP1).state;
    expect(afterP2.phase).toEqual({ kind: "zombie_phase" });
  });

  it("throws outside a player turn", () => {
    const state: GameState = { ...makeTestState(), phase: { kind: "zombie_phase" } };
    expect(() => endActiveTurn(state)).toThrow(/expected player_turn/);
  });
});

describe("resolveEndOfRound", () => {
  it("increments the round, refills action points, and restarts turn order", () => {
    const base = makeTestState({ players: [P1, P2], maxActionPoints: 4 });
    const spent: GameState = {
      ...base,
      phase: { kind: "end_of_round" },
      players: base.players.map((p) => ({ ...p, actionPoints: 1 })),
    };
    const { state, events } = resolveEndOfRound(spent);
    expect(state.round).toBe(2);
    expect(state.players.every((p) => p.actionPoints === 4)).toBe(true);
    expect(activeId(state)).toBe(P1);
    expect(events[0]).toEqual({ type: "round_started", round: 2 });
  });
});

describe("advanceUntilPlayerInput", () => {
  it("runs zombie phase and end of round back to a player turn", () => {
    const base = makeTestState({ players: [P1, P2] });
    const inZombiePhase: GameState = { ...base, phase: { kind: "zombie_phase" } };
    const { state, events } = advanceUntilPlayerInput(inZombiePhase);
    expect(state.round).toBe(2);
    expect(activeId(state)).toBe(P1);
    expect(events.map((e) => e.type)).toEqual([
      "phase_changed",
      "round_started",
      "phase_changed",
      "turn_started",
    ]);
  });

  it("is a no-op during a player turn", () => {
    const state = makeTestState();
    expect(advanceUntilPlayerInput(state)).toEqual({ state, events: [] });
  });
});

describe("presence and the active player", () => {
  it("hands the turn on when the active player disconnects", () => {
    const state = makeTestState({ players: [P1, P2] });
    const result = applyCommand(state, {
      type: "set_player_presence",
      playerId: P1,
      present: false,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(activeId(result.state)).toBe(P2);
    expect(findPlayer(result.state, P1)?.present).toBe(false);
  });

  it("pauses on the absent active player when nobody else is present", () => {
    const state = makeTestState({ players: [P1] });
    const result = applyCommand(state, {
      type: "set_player_presence",
      playerId: P1,
      present: false,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(activeId(result.state)).toBe(P1);
    expect(result.state.round).toBe(1);
  });

  it("resumes with the returning player when the paused active player is still absent", () => {
    const state = makeTestState({ players: [P1, P2] });
    const bothGone = [P1, P2].reduce((s, id) => {
      const r = applyCommand(s, { type: "set_player_presence", playerId: id, present: false });
      if (!r.ok) throw new Error(r.reason);
      return r.state;
    }, state);
    expect(activeId(bothGone)).toBe(P2);

    const p1Back = applyCommand(bothGone, {
      type: "set_player_presence",
      playerId: P1,
      present: true,
    });
    if (!p1Back.ok) throw new Error(p1Back.reason);
    expect(activeId(p1Back.state)).toBe(P1);
  });

  it("ignores presence changes that change nothing", () => {
    const state = makeTestState();
    const result = applyCommand(state, {
      type: "set_player_presence",
      playerId: P1,
      present: true,
    });
    expect(result).toEqual({ ok: true, state, events: [] });
  });
});

describe("active player is always eligible (audit C1)", () => {
  it("never makes a down survivor active when a teammate is merely absent", () => {
    // P2 absent, P1 downed by a 10-damage walker during the zombie phase.
    const layout = parseAsciiMap(["######", "#SZ..#", "#S...#", "######"]);
    const base = makeTestState({ players: [P1, P2], layout, zombieDamage: 10 });
    const absent = applyCommand(base, {
      type: "set_player_presence",
      playerId: P2,
      present: false,
    });
    if (!absent.ok) throw new Error(absent.reason);
    const ended = applyCommand(absent.state, { type: "end_turn", playerId: P1 });
    if (!ended.ok) throw new Error(ended.reason);
    expect(findPlayer(ended.state, P1)?.status).toBe("down");
    // The round pauses on the standing (absent) P2, never on the down P1.
    expect(activeId(ended.state)).toBe(P2);
    expect(
      applyCommand(ended.state, { type: "fire_weapon", playerId: P1, targetId: zombieId("z1") }),
    ).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
    // P2 returns and can act immediately.
    const back = applyCommand(ended.state, {
      type: "set_player_presence",
      playerId: P2,
      present: true,
    });
    if (!back.ok) throw new Error(back.reason);
    expect(activeId(back.state)).toBe(P2);
    expect(applyCommand(back.state, { type: "end_turn", playerId: P2 }).ok).toBe(true);
  });

  it("rejects commands from a down survivor even if they somehow hold the turn", () => {
    const base = makeTestState({ players: [P1] });
    const corrupted: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, status: "down", health: 0 })),
    };
    expect(applyCommand(corrupted, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "PLAYER_NOT_ACTIVE",
    });
  });
});
