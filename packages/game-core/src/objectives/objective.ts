import type { GameEvent } from "../events/types.js";
import type { MapLayout } from "../map/asciiMap.js";
import type { Position } from "../map/types.js";
import type { ObjectiveStepSettings, ScenarioDefinition } from "../state/definitions.js";
import type { GameState, MatchOutcome, ObjectiveState, ObjectiveStep } from "../state/types.js";
import { evaluateStep, stepZone } from "./steps.js";

/** The tiles a location reference names on this layout. */
export function resolveLocation(
  layout: MapLayout,
  location: ObjectiveStepSettings extends infer S
    ? S extends { readonly location: infer L }
      ? L
      : never
    : never,
): readonly Position[] {
  switch (location) {
    case "extraction":
      return layout.extractionZone;
    case "safehouse":
      // Hand-authored maps without `H` tiles fall back to the spawn tiles themselves.
      return layout.safehouse.length > 0 ? layout.safehouse : layout.spawnPositions;
  }
}

/** Turns a step's settings into its round-1 runtime state. */
function createStep(layout: MapLayout, settings: ObjectiveStepSettings): ObjectiveStep {
  switch (settings.kind) {
    case "reach_location":
      return {
        kind: "reach_location",
        location: settings.location,
        zone: resolveLocation(layout, settings.location),
        holdRounds: settings.holdRounds,
        roundsHeld: 0,
        ...(settings.requireItem === undefined ? {} : { requireItem: settings.requireItem }),
      };
    case "acquire_item":
      return { kind: "acquire_item", itemType: settings.itemType };
    case "survive_rounds":
      return { kind: "survive_rounds", rounds: settings.rounds, roundsSurvived: 0 };
  }
}

/** Builds the round-1 objective state: every step in order, the first one active. */
export function createObjective(layout: MapLayout, scenario: ScenarioDefinition): ObjectiveState {
  return {
    scenario: scenario.type,
    steps: scenario.steps.map((s) => createStep(layout, s)),
    current: 0,
    status: "in_progress",
  };
}

export interface ObjectiveEvaluation {
  readonly objective: ObjectiveState;
  /** Set when the objective decides the match. */
  readonly outcome: MatchOutcome | undefined;
  readonly events: readonly GameEvent[];
}

/**
 * Evaluated once per end of round, after the zombie phase. Only the current step is
 * checked; completing it activates the next one for the following round, and completing
 * the last one wins the match. The caller handles "everyone is down" before calling this.
 */
export function evaluateObjective(state: GameState): ObjectiveEvaluation {
  const objective = state.objective;
  const step = objective.steps[objective.current];
  if (objective.status !== "in_progress" || step === undefined) {
    return { objective, outcome: undefined, events: [] };
  }
  const result = evaluateStep(state, objective.current, step);
  const steps = objective.steps.map((s, i) => (i === objective.current ? result.step : s));
  if (!result.complete) {
    return { objective: { ...objective, steps }, outcome: undefined, events: result.events };
  }
  const completed: GameEvent = { type: "objective_step_completed", stepIndex: objective.current };
  const next = objective.current + 1;
  if (next >= steps.length) {
    return {
      objective: { ...objective, steps, current: next, status: "complete" },
      outcome: "victory",
      events: [...result.events, completed],
    };
  }
  return {
    objective: { ...objective, steps, current: next },
    outcome: undefined,
    events: [...result.events, completed, { type: "objective_step_started", stepIndex: next }],
  };
}

/** The current step, or undefined once the scenario is complete. */
export function currentStep(objective: ObjectiveState): ObjectiveStep | undefined {
  return objective.steps[objective.current];
}

/** Tiles the current step wants the players to notice (drawn by the client). */
export function objectiveZoneTiles(objective: ObjectiveState): readonly Position[] {
  const step = currentStep(objective);
  return step === undefined ? [] : stepZone(step);
}

/** Mode-neutral progress summary for user interfaces; no wording, just numbers. */
export interface ObjectiveProgress {
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly step: ObjectiveStep | undefined;
  readonly standingTotal: number;
  /** Standing survivors inside the current step's zone (0 for steps without one). */
  readonly standingInZone: number;
  /** Standing survivors carrying the item the current step asks for (0 when none is asked). */
  readonly carriers: number;
}

export function objectiveProgress(state: GameState): ObjectiveProgress {
  const step = currentStep(state.objective);
  const standing = state.players.filter((p) => p.status === "active");
  const zone = step === undefined ? [] : stepZone(step);
  const wanted =
    step?.kind === "acquire_item"
      ? step.itemType
      : step?.kind === "reach_location"
        ? step.requireItem
        : undefined;
  return {
    stepIndex: state.objective.current,
    stepCount: state.objective.steps.length,
    step,
    standingTotal: standing.length,
    standingInZone: standing.filter((p) =>
      zone.some((z) => z.x === p.position.x && z.y === p.position.y),
    ).length,
    carriers:
      wanted === undefined ? 0 : standing.filter((p) => p.inventory.includes(wanted)).length,
  };
}
