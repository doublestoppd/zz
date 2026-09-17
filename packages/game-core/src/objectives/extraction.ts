import type { GameEvent } from "../events/types.js";
import { positionsEqual } from "../map/position.js";
import type { ExtractionObjectiveState, GameState, MatchOutcome } from "../state/types.js";

export interface ObjectiveEvaluation {
  readonly objective: ExtractionObjectiveState;
  /** Set when the objective decides the match. */
  readonly outcome: MatchOutcome | undefined;
  readonly events: readonly GameEvent[];
}

/** True when the player stands on an extraction tile. */
export function isInExtractionZone(
  objective: ExtractionObjectiveState,
  position: GameState["players"][number]["position"],
): boolean {
  return objective.extractionZone.some((p) => positionsEqual(p, position));
}

/**
 * Evaluated once per end of round, after the zombie phase. All standing survivors must be
 * inside the zone; down survivors are left behind and do not count. The zone must then be
 * held for `holdoutRounds` further checks. Leaving the zone resets the count.
 * The caller handles "everyone is down" before calling this.
 */
export function evaluateExtraction(state: GameState): ObjectiveEvaluation {
  const objective = state.objective;
  if (objective.status !== "in_progress") return { objective, outcome: undefined, events: [] };

  const standing = state.players.filter((p) => p.status === "active");
  const allInZone =
    standing.length > 0 && standing.every((p) => isInExtractionZone(objective, p.position));

  if (!allInZone) {
    if (objective.roundsHeld === 0) return { objective, outcome: undefined, events: [] };
    const reset: ExtractionObjectiveState = { ...objective, roundsHeld: 0 };
    return {
      objective: reset,
      outcome: undefined,
      events: [
        { type: "extraction_progress", roundsHeld: 0, holdoutRounds: objective.holdoutRounds },
      ],
    };
  }

  const roundsHeld = objective.roundsHeld + 1;
  const complete = roundsHeld > objective.holdoutRounds;
  const updated: ExtractionObjectiveState = {
    ...objective,
    roundsHeld,
    status: complete ? "complete" : "in_progress",
  };
  return {
    objective: updated,
    outcome: complete ? "victory" : undefined,
    events: [{ type: "extraction_progress", roundsHeld, holdoutRounds: objective.holdoutRounds }],
  };
}
