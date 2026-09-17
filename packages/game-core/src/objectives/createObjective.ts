import type { MapLayout } from "../map/asciiMap.js";
import type { ObjectiveSettings } from "../state/definitions.js";
import type { ObjectiveState } from "../state/types.js";

/**
 * Builds the round-1 objective state for the configured game mode. Adding a mode means a
 * new `ObjectiveSettings` member, a new `ObjectiveState` member, and a case here; the
 * exhaustive switch reports every other place that must learn about it.
 */
export function createObjective(layout: MapLayout, settings: ObjectiveSettings): ObjectiveState {
  switch (settings.kind) {
    case "extraction":
      return {
        kind: "extraction",
        extractionZone: layout.extractionZone,
        holdoutRounds: settings.holdoutRounds,
        roundsHeld: 0,
        status: "in_progress",
      };
  }
}
