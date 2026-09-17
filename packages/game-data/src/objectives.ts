import type { ObjectiveSettings } from "@zombie/game-core";

/** The game mode every match plays for now, and its settings. */
export const DEFAULT_OBJECTIVE: ObjectiveSettings = {
  kind: "extraction",
  /** Rounds the survivors must hold the extraction zone after first reaching it together. */
  holdoutRounds: 1,
};
