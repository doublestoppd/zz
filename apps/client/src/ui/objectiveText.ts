import {
  objectiveProgress,
  type GameState,
  type MatchOutcome,
  type ObjectiveState,
} from "@zombie/game-core";

/** The objective line shown while the match runs. Switches on the mode so a new one cannot be forgotten. */
export function describeObjective(state: GameState): string {
  const progress = objectiveProgress(state);
  switch (progress.kind) {
    case "extraction": {
      const where = `Objective: get every standing survivor into the green zone (${progress.standingInZone}/${progress.standingTotal} there)`;
      if (progress.roundsHeld > 0) {
        return `${where}, held ${progress.roundsHeld}/${progress.holdoutRounds + 1} rounds`;
      }
      return progress.holdoutRounds > 0
        ? `${where}, then hold it for ${progress.holdoutRounds} more round(s)`
        : where;
    }
  }
}

/** The banner text when the match ends. */
export function describeOutcome(objective: ObjectiveState, outcome: MatchOutcome): string {
  if (outcome === "defeat") return "Everyone is down. Defeat.";
  switch (objective.kind) {
    case "extraction":
      return "Extraction successful. Victory!";
  }
}
