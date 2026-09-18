import type { ContainerCategory, SearchLootTable } from "@zombie/game-core";

/**
 * What searching a location yields, per kind of place. Weights are relative within a table;
 * "nothing" draws make a place feel picked over. Tune here, not in game-core.
 */
export const SEARCH_LOOT_TABLES: Readonly<Record<ContainerCategory, SearchLootTable>> = {
  home: {
    minRolls: 1,
    maxRolls: 2,
    entries: [
      { type: "bandage", weight: 4 },
      { type: "ammo_box", weight: 2 },
      { type: "medkit", weight: 1 },
      { type: "nothing", weight: 3 },
    ],
  },
  clinic: {
    minRolls: 1,
    maxRolls: 2,
    entries: [
      { type: "medkit", weight: 4 },
      { type: "bandage", weight: 4 },
      { type: "nothing", weight: 1 },
    ],
  },
  police: {
    minRolls: 1,
    maxRolls: 2,
    entries: [
      { type: "ammo_box", weight: 5 },
      { type: "medkit", weight: 1 },
      { type: "nothing", weight: 2 },
    ],
  },
  shop: {
    minRolls: 0,
    maxRolls: 2,
    entries: [
      { type: "bandage", weight: 2 },
      { type: "ammo_box", weight: 2 },
      { type: "nothing", weight: 3 },
    ],
  },
};
