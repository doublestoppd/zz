import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { itemId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import type { ScenarioDefinition } from "../state/definitions.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { resolveEndOfRound } from "../turn/phases.js";
import {
  createObjective,
  evaluateObjective,
  objectiveProgress,
  objectiveZoneTiles,
} from "./objective.js";

/** Two spawns, a two-tile zone one step to the right of each. */
const LAYOUT = parseAsciiMap(["#####", "#SE.#", "#SE.#", "#####"]);

const RETRIEVAL: ScenarioDefinition = {
  type: "retrieval",
  name: "Radio parts",
  description: "",
  steps: [
    { kind: "acquire_item", itemType: "radio_parts" },
    { kind: "reach_location", location: "safehouse", holdRounds: 0, requireItem: "radio_parts" },
  ],
};

/** P1 spawns on a safehouse tile; the radio parts lie three tiles east. */
const TOWN = parseAsciiMap(["#######", "#SH..R#", "#H....#", "#######"]);

function moveAllIntoZone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, position: { x: 2, y: p.position.y } })),
  };
}

function endOfRound(state: GameState): GameState {
  return { ...state, phase: { kind: "end_of_round" } };
}

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("extraction through the step model", () => {
  it("does nothing while anyone standing is outside the zone", () => {
    const state = makeTestState({ players: [P1, P2], layout: LAYOUT });
    expect(evaluateObjective(state)).toEqual({
      objective: state.objective,
      outcome: undefined,
      events: [],
    });
    expect(objectiveZoneTiles(state.objective)).toEqual(LAYOUT.extractionZone);
  });

  it("completes immediately with no holdout when everyone standing is inside", () => {
    const state = moveAllIntoZone(
      makeTestState({ players: [P1, P2], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const result = evaluateObjective(state);
    expect(result.outcome).toBe("victory");
    expect(result.objective).toMatchObject({ status: "complete", current: 1 });
    expect(result.events).toEqual([
      { type: "objective_progress", stepIndex: 0, held: 1, needed: 0 },
      { type: "objective_step_completed", stepIndex: 0 },
    ]);
  });

  it("counts holdout rounds and resets when the zone is abandoned", () => {
    const base = makeTestState({ players: [P1, P2], layout: LAYOUT, holdoutRounds: 2 });
    const first = evaluateObjective(moveAllIntoZone(base));
    expect(first.outcome).toBeUndefined();
    expect(first.objective.steps[0]).toMatchObject({ roundsHeld: 1 });
    const held: GameState = { ...moveAllIntoZone(base), objective: first.objective };
    const second = evaluateObjective(held);
    expect(second.objective.steps[0]).toMatchObject({ roundsHeld: 2 });
    const third = evaluateObjective({ ...held, objective: second.objective });
    expect(third.outcome).toBe("victory");
    const reset = evaluateObjective({ ...base, objective: second.objective });
    expect(reset.objective.steps[0]).toMatchObject({ roundsHeld: 0 });
    expect(reset.events).toEqual([
      { type: "objective_progress", stepIndex: 0, held: 0, needed: 2 },
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
    expect(evaluateObjective(p2Down).outcome).toBe("victory");
  });

  it("ends the match in victory at end of round and rejects further commands", () => {
    const state = moveAllIntoZone(
      makeTestState({ players: [P1], layout: LAYOUT, holdoutRounds: 0 }),
    );
    const result = must(applyCommand(state, { type: "end_turn", playerId: P1 }));
    expect(result.state.phase).toEqual({ kind: "finished", outcome: "victory" });
    expect(result.state.objective.status).toBe("complete");
    expect(result.events.map((e) => e.type)).toEqual([
      "turn_ended",
      "phase_changed",
      "phase_changed",
      "objective_progress",
      "objective_step_completed",
      "phase_changed",
      "match_ended",
    ]);
    expect(applyCommand(result.state, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "MATCH_FINISHED",
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

describe("retrieval: a two-step scenario on the same match loop", () => {
  it("places the item at the objective spawn and activates the first step", () => {
    const state = makeTestState({ players: [P1], layout: TOWN, scenario: RETRIEVAL });
    expect(state.items).toContainEqual({ id: "o1", type: "radio_parts", position: { x: 5, y: 1 } });
    expect(state.objective).toMatchObject({
      scenario: "retrieval",
      current: 0,
      status: "in_progress",
    });
    expect(createObjective(TOWN, RETRIEVAL).steps[1]).toMatchObject({
      kind: "reach_location",
      zone: [
        { x: 2, y: 1 },
        { x: 1, y: 2 },
      ],
    });
    expect(objectiveZoneTiles(state.objective)).toEqual([]);
    expect(objectiveProgress(state)).toMatchObject({ stepIndex: 0, stepCount: 2, carriers: 0 });
  });

  it("advances only in order: standing at home without the parts does nothing", () => {
    const state = makeTestState({ players: [P1], layout: TOWN, scenario: RETRIEVAL });
    const home: GameState = {
      ...state,
      players: state.players.map((p) => ({ ...p, position: { x: 2, y: 1 } })),
    };
    expect(evaluateObjective(home)).toMatchObject({ outcome: undefined, events: [] });
    expect(evaluateObjective(home).objective.current).toBe(0);
  });

  it("completes step by step and wins when the parts are carried home", () => {
    const state = makeTestState({ players: [P1], layout: TOWN, scenario: RETRIEVAL });
    // Walk to the parts (4 AP: exactly enough), pick them up next round.
    const walked = must(applyCommand(state, { type: "move", playerId: P1, to: { x: 5, y: 1 } }));
    const r2 = must(applyCommand(walked.state, { type: "end_turn", playerId: P1 }));
    const picked = must(
      applyCommand(r2.state, { type: "pick_up", playerId: P1, itemId: itemId("o1") }),
    );
    expect(picked.state.objective.current).toBe(0);
    const r3 = must(applyCommand(picked.state, { type: "end_turn", playerId: P1 }));
    expect(r3.events).toContainEqual({ type: "objective_step_completed", stepIndex: 0 });
    expect(r3.events).toContainEqual({ type: "objective_step_started", stepIndex: 1 });
    expect(r3.state.objective.current).toBe(1);
    expect(objectiveZoneTiles(r3.state.objective)).toHaveLength(2);
    // Home again with the parts: victory at the end of that round.
    const back = must(applyCommand(r3.state, { type: "move", playerId: P1, to: { x: 2, y: 1 } }));
    const r4 = must(applyCommand(back.state, { type: "end_turn", playerId: P1 }));
    expect(r4.state.phase).toEqual({ kind: "finished", outcome: "victory" });
    expect(r4.state.objective).toMatchObject({ status: "complete", current: 2 });
  });

  it("a survivor at home without the parts cannot finish for the one who carries them", () => {
    const layout = parseAsciiMap(["#######", "#SH..R#", "#SH...#", "#######"]);
    const state = makeTestState({ players: [P1, P2], layout, scenario: RETRIEVAL });
    const staged: GameState = {
      ...state,
      objective: { ...state.objective, current: 1 },
      players: state.players.map((p) =>
        p.id === P1
          ? { ...p, position: { x: 2, y: 1 } }
          : { ...p, position: { x: 4, y: 2 }, inventory: ["radio_parts"] },
      ),
    };
    expect(evaluateObjective(staged).outcome).toBeUndefined();
    const together: GameState = {
      ...staged,
      players: staged.players.map((p) => (p.id === P2 ? { ...p, position: { x: 2, y: 2 } } : p)),
    };
    expect(evaluateObjective(together).outcome).toBe("victory");
  });

  it("rejects a layout that cannot host the scenario", () => {
    const noSpot = parseAsciiMap(["#####", "#SH.#", "#####"]);
    expect(() => makeTestState({ players: [P1], layout: noSpot, scenario: RETRIEVAL })).toThrow(
      /needs objective spawn 1/,
    );
    const bogus: ScenarioDefinition = { ...RETRIEVAL, steps: [] };
    expect(() => makeTestState({ players: [P1], layout: TOWN, scenario: bogus })).toThrow(
      /no steps/,
    );
  });

  it("survive_rounds counts end-of-round checks", () => {
    const scenario: ScenarioDefinition = {
      type: "extraction",
      name: "Hold out",
      description: "",
      steps: [{ kind: "survive_rounds", rounds: 2 }],
    };
    const state = makeTestState({ players: [P1], layout: TOWN, scenario });
    const r1 = must(applyCommand(state, { type: "end_turn", playerId: P1 }));
    expect(r1.state.objective.steps[0]).toMatchObject({ roundsSurvived: 1 });
    expect(r1.state.phase.kind).toBe("player_turn");
    const r2 = must(applyCommand(r1.state, { type: "end_turn", playerId: P1 }));
    expect(r2.state.phase).toEqual({ kind: "finished", outcome: "victory" });
  });

  it("is deterministic", () => {
    const a = makeTestState({ players: [P1], layout: TOWN, scenario: RETRIEVAL, seed: 4 });
    const b = makeTestState({ players: [P1], layout: TOWN, scenario: RETRIEVAL, seed: 4 });
    expect(a).toEqual(b);
  });
});
