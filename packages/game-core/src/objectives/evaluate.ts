import type { Position } from "../map/types.js";
import type { GameState, ObjectiveState } from "../state/types.js";
import { evaluateExtraction, isInExtractionZone, type ObjectiveEvaluation } from "./extraction.js";

/** Dispatches end-of-round evaluation to the configured game mode. */
export function evaluateObjective(state: GameState): ObjectiveEvaluation {
  switch (state.objective.kind) {
    case "extraction":
      return evaluateExtraction(state);
  }
}

/** Tiles the objective wants the players to notice (drawn by the client). */
export function objectiveZoneTiles(objective: ObjectiveState): readonly Position[] {
  switch (objective.kind) {
    case "extraction":
      return objective.extractionZone;
  }
}

/** Mode-neutral progress summary for user interfaces; no wording, just numbers. */
export type ObjectiveProgress = ExtractionProgress;

export interface ExtractionProgress {
  readonly kind: "extraction";
  readonly standingInZone: number;
  readonly standingTotal: number;
  readonly roundsHeld: number;
  readonly holdoutRounds: number;
}

export function objectiveProgress(state: GameState): ObjectiveProgress {
  switch (state.objective.kind) {
    case "extraction": {
      const objective = state.objective;
      const standing = state.players.filter((p) => p.status === "active");
      return {
        kind: "extraction",
        standingInZone: standing.filter((p) => isInExtractionZone(objective, p.position)).length,
        standingTotal: standing.length,
        roundsHeld: objective.roundsHeld,
        holdoutRounds: objective.holdoutRounds,
      };
    }
  }
}
