import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { resolveEndOfRound } from "../turn/phases.js";
import { evaluateExtraction } from "./extraction.js";

/** Two spawns, a two-tile zone one step to the right of each. */
const LAYOUT = parseAsciiMap(["#####", "#SE.#", "#SE.#", "#####"]);

function moveAllIntoZone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, position: { x: 2, y: p.position.y } })),
  };
}

function endOfRound(state: GameState): GameState {
  return { ...state, phase: { kind: "end_of_round" } };
}

describe("evaluateExtraction", () => {
  it("does nothing while anyone standing is outside the zone", () => {
    const state = makeTestState({ players: [P1, P2], layout: LAYOUT });
    expect(evaluateExtraction(state)).toEqual({
      objective: state.objective,
      outcome: undefined,
      events: [],
    });
  });

  it("completes immediately with no holdout when everyone standing is inside", () => {
    const state = moveAllIntoZone(
      makeTestState({ players: [P1, P2], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const result = evaluateExtraction(state);
    expect(result.outcome).toBe("victory");
    expect(result.objective).toMatchObject({ status: "complete", roundsHeld: 1 });
    expect(result.events).toEqual([
      { type: "extraction_progress", roundsHeld: 1, holdoutRounds: 0 },
    ]);
  });

  it("counts holdout rounds and resets when the zone is abandoned", () => {
    const base = makeTestState({ players: [P1, P2], layout: LAYOUT, holdoutRounds: 2 });
    const first = evaluateExtraction(moveAllIntoZone(base));
    expect(first).toMatchObject({
      outcome: undefined,
      objective: { roundsHeld: 1, status: "in_progress" },
    });

    const held: GameState = { ...moveAllIntoZone(base), objective: first.objective };
    const second = evaluateExtraction(held);
    expect(second.objective.roundsHeld).toBe(2);
    expect(second.outcome).toBeUndefined();

    const third = evaluateExtraction({ ...held, objective: second.objective });
    expect(third.outcome).toBe("victory");

    const left: GameState = { ...base, objective: second.objective };
    const reset = evaluateExtraction(left);
    expect(reset.objective.roundsHeld).toBe(0);
    expect(reset.events).toEqual([
      { type: "extraction_progress", roundsHeld: 0, holdoutRounds: 2 },
    ]);
  });

  it("ignores down survivors but needs at least one standing survivor", () => {
    const base = moveAllIntoZone(
      makeTestState({ players: [P1, P2], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const p2Down: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === P2 ? { ...p, status: "down", health: 0, position: { x: 1, y: 2 } } : p,
      ),
    };
    expect(evaluateExtraction(p2Down).outcome).toBe("victory");
  });
});

describe("extraction in the round loop", () => {
  it("ends the match in victory at end of round and rejects further commands", () => {
    const state = moveAllIntoZone(
      makeTestState({ players: [P1], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const result = applyCommand(state, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.phase).toEqual({ kind: "finished", outcome: "victory" });
    expect(result.state.objective.status).toBe("complete");
    expect(result.events.map((e) => e.type)).toEqual([
      "turn_ended",
      "phase_changed",
      "phase_changed",
      "extraction_progress",
      "phase_changed",
      "match_ended",
    ]);
    expect(applyCommand(result.state, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "MATCH_FINISHED",
    });
  });

  it("carries the hold count into the next round", () => {
    const state = moveAllIntoZone(
      makeTestState({ players: [P1], layout: LAYOUT, holdoutRounds: 1 }),
    );
    const result = applyCommand(state, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.round).toBe(2);
    expect(result.state.objective.roundsHeld).toBe(1);
    expect(result.events).toContainEqual({
      type: "extraction_progress",
      roundsHeld: 1,
      holdoutRounds: 1,
    });
  });

  it("prefers defeat when everyone is down even inside the zone", () => {
    const base = moveAllIntoZone(
      makeTestState({ players: [P1], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const allDown = endOfRound({
      ...base,
      players: base.players.map((p) => ({ ...p, status: "down", health: 0 })),
    });
    const { state } = resolveEndOfRound(allDown);
    expect(state.phase).toEqual({ kind: "finished", outcome: "defeat" });
    expect(state.objective.status).toBe("in_progress");
  });
});
