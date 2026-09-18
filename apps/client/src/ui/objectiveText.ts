import {
  objectiveProgress,
  type GameState,
  type MatchOutcome,
  type ObjectiveState,
} from "@zombie/game-core";

const PLACE_NAMES = {
  extraction: "the green extraction zone",
  safehouse: "the safehouse",
} as const;

/** The objective line shown while the match runs. Switches on the step kind so a new primitive cannot be forgotten. */
export function describeObjective(state: GameState): string {
  const progress = objectiveProgress(state);
  const { step } = progress;
  const prefix =
    progress.stepCount > 1
      ? `Step ${progress.stepIndex + 1}/${progress.stepCount}: `
      : "Objective: ";
  if (step === undefined) return "Objective complete.";
  switch (step.kind) {
    case "reach_location": {
      const place = PLACE_NAMES[step.location];
      const who = `get every standing survivor into ${place} (${progress.standingInZone}/${progress.standingTotal} there)`;
      const item =
        step.requireItem === undefined
          ? ""
          : ` carrying the ${step.requireItem.replace("_", " ")} (${progress.carriers} carrying)`;
      if (step.roundsHeld > 0) {
        return `${prefix}${who}${item}, held ${step.roundsHeld}/${step.holdRounds + 1} rounds`;
      }
      return step.holdRounds > 0
        ? `${prefix}${who}${item}, then hold it for ${step.holdRounds} more round(s)`
        : `${prefix}${who}${item}`;
    }
    case "acquire_item":
      return `${prefix}find and pick up the ${step.itemType.replace("_", " ")} (${progress.carriers} carrying)`;
    case "survive_rounds":
      return `${prefix}survive ${step.rounds} rounds (${step.roundsSurvived} so far)`;
  }
}

/** The banner text when the match ends. */
export function describeOutcome(objective: ObjectiveState, outcome: MatchOutcome): string {
  if (outcome === "defeat") return "Everyone is down. Defeat.";
  switch (objective.scenario) {
    case "extraction":
      return "Extraction successful. Victory!";
    case "retrieval":
      return "Radio parts delivered. Victory!";
  }
}
