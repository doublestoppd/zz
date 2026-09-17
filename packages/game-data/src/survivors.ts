import type { SurvivorDefinition } from "@zombie/game-core";

/** Starting statistics for every survivor. Per-character classes can replace this record later. */
export const DEFAULT_SURVIVOR: SurvivorDefinition = {
  maxHealth: 10,
  maxActionPoints: 4,
};
