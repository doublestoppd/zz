import { describe, expect, it } from "vitest";
import { makeClientTestState } from "../input/testState.js";
import { describeObjective, describeOutcome } from "./objectiveText.js";

describe("objective text", () => {
  it("describes extraction progress from the state", () => {
    const state = makeClientTestState(["#####", "#S.E#", "#S.E#", "#####"]);
    expect(describeObjective(state)).toBe(
      "Objective: get every standing survivor into the green zone (0/2 there)",
    );
    const holding = {
      ...state,
      objective: { ...state.objective, holdoutRounds: 1, roundsHeld: 1 },
    };
    expect(describeObjective(holding)).toMatch(/held 1\/2 rounds/);
  });

  it("names the outcome", () => {
    const state = makeClientTestState();
    expect(describeOutcome(state.objective, "victory")).toMatch(/Victory/);
    expect(describeOutcome(state.objective, "defeat")).toMatch(/Defeat/);
  });
});
