import type { ScenarioDefinition, ScenarioType } from "@zombie/game-core";

/**
 * One entry per `ScenarioType`; the compiler rejects a missing one. A scenario is a
 * sequence of objective primitives; the match loop never knows which scenario it runs.
 */
export const SCENARIOS: Readonly<Record<ScenarioType, ScenarioDefinition>> = {
  extraction: {
    type: "extraction",
    name: "Extraction",
    description: "Get every standing survivor into the extraction zone and hold it for a round.",
    steps: [{ kind: "reach_location", location: "extraction", holdRounds: 1 }],
  },
  retrieval: {
    type: "retrieval",
    name: "Radio parts",
    description:
      "Find the radio parts somewhere in the city and carry them back to the safehouse where you started.",
    steps: [
      { kind: "acquire_item", itemType: "radio_parts" },
      { kind: "reach_location", location: "safehouse", holdRounds: 0, requireItem: "radio_parts" },
    ],
  },
};

/** What a lobby plays unless the host picks otherwise. */
export const DEFAULT_SCENARIO: ScenarioDefinition = SCENARIOS.extraction;
