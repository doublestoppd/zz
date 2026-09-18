import type { SurvivorDefinition } from "@zombie/game-core";

/** Starting statistics for every survivor. Per-character classes can replace this record later. */
export const DEFAULT_SURVIVOR: SurvivorDefinition = {
  maxHealth: 10,
  maxActionPoints: 4,
  startingWeapon: "pistol",
  startingMeleeWeapon: "knife",
  startingReserveAmmo: { pistol_rounds: 12, shells: 0, rifle_rounds: 0 },
  inventoryCapacity: 3,
};
