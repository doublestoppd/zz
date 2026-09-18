import { describe, expect, it } from "vitest";
import { makeClientTestState } from "../input/testState.js";
import { describeObjective, describeOutcome } from "./objectiveText.js";

describe("objective text", () => {
  it("describes extraction progress from the state", () => {
    const state = makeClientTestState(["#####", "#S.E#", "#S.E#", "#####"]);
    expect(describeObjective(state)).toBe(
      "Objective: get every standing survivor into the green extraction zone (0/2 there)",
    );
    const holding = {
      ...state,
      objective: {
        ...state.objective,
        steps: state.objective.steps.map((s) =>
          s.kind === "reach_location" ? { ...s, holdRounds: 1, roundsHeld: 1 } : s,
        ),
      },
    };
    expect(describeObjective(holding)).toMatch(/held 1\/2 rounds/);
  });

  it("numbers the steps of a multi-step scenario and names the item to carry", () => {
    const state = makeClientTestState(["#####", "#S.E#", "#S.E#", "#####"]);
    const retrieval = {
      ...state,
      objective: {
        scenario: "retrieval" as const,
        current: 1,
        status: "in_progress" as const,
        steps: [
          { kind: "acquire_item" as const, itemType: "radio_parts" as const },
          {
            kind: "reach_location" as const,
            location: "safehouse" as const,
            zone: [{ x: 1, y: 1 }],
            holdRounds: 0,
            roundsHeld: 0,
            requireItem: "radio_parts" as const,
          },
        ],
      },
    };
    expect(describeObjective(retrieval)).toBe(
      "Step 2/2: get every standing survivor into the safehouse (1/2 there) carrying the radio parts (0 carrying)",
    );
    expect(
      describeObjective({ ...retrieval, objective: { ...retrieval.objective, current: 0 } }),
    ).toBe("Step 1/2: find and pick up the radio parts (0 carrying)");
  });

  it("names the outcome", () => {
    const state = makeClientTestState();
    expect(describeOutcome(state.objective, "victory")).toMatch(/Victory/);
    expect(describeOutcome(state.objective, "defeat")).toMatch(/Defeat/);
  });
});
