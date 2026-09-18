import type { GameEvent } from "../events/types.js";
import { positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { GameState, ObjectiveStep, PlayerState } from "../state/types.js";

/** The result of checking one step at the end of a round. */
export interface StepEvaluation {
  readonly step: ObjectiveStep;
  readonly complete: boolean;
  readonly events: readonly GameEvent[];
}

function standingSurvivors(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.status === "active");
}

function inZone(zone: readonly Position[], position: Position): boolean {
  return zone.some((p) => positionsEqual(p, position));
}

/**
 * Evaluates the current step against the board at the end of a round. Each primitive is a
 * pure function of the state; adding a primitive means a new member of `ObjectiveStep`
 * and a case here (the exhaustive switch reports the client text and progress helpers).
 */
export function evaluateStep(state: GameState, index: number, step: ObjectiveStep): StepEvaluation {
  switch (step.kind) {
    case "reach_location": {
      const standing = standingSurvivors(state);
      const everyoneThere =
        standing.length > 0 && standing.every((p) => inZone(step.zone, p.position));
      const wanted = step.requireItem;
      const itemThere =
        wanted === undefined ||
        standing.some((p) => inZone(step.zone, p.position) && p.inventory.includes(wanted));
      if (!everyoneThere || !itemThere) {
        if (step.roundsHeld === 0) return { step, complete: false, events: [] };
        const reset = { ...step, roundsHeld: 0 };
        return { step: reset, complete: false, events: [progress(index, 0, step.holdRounds)] };
      }
      const roundsHeld = step.roundsHeld + 1;
      const complete = roundsHeld > step.holdRounds;
      return {
        step: { ...step, roundsHeld },
        complete,
        events: [progress(index, roundsHeld, step.holdRounds)],
      };
    }
    case "acquire_item": {
      const carried = standingSurvivors(state).some((p) => p.inventory.includes(step.itemType));
      return { step, complete: carried, events: [] };
    }
    case "survive_rounds": {
      const roundsSurvived = step.roundsSurvived + 1;
      return {
        step: { ...step, roundsSurvived },
        complete: roundsSurvived >= step.rounds,
        events: [progress(index, roundsSurvived, step.rounds)],
      };
    }
  }
}

function progress(stepIndex: number, held: number, needed: number): GameEvent {
  return { type: "objective_progress", stepIndex, held, needed };
}

/** Tiles a step wants the players to notice; empty for steps without a place. */
export function stepZone(step: ObjectiveStep): readonly Position[] {
  switch (step.kind) {
    case "reach_location":
      return step.zone;
    case "acquire_item":
    case "survive_rounds":
      return [];
  }
}
