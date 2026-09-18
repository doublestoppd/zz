import type { GameRules } from "@zombie/game-core";
import { SEARCH_LOOT_TABLES } from "./containers.js";
import { ITEM_DEFINITIONS } from "./items.js";
import { WEAPON_DEFINITIONS } from "./weapons.js";
import { ZOMBIE_DEFINITIONS } from "./zombies.js";

/** Numbers that tune the core rules. Change balance here, not in game-core. */
export const DEFAULT_GAME_RULES: GameRules = {
  moveCostPerTile: 1,
  zombieDefinitions: ZOMBIE_DEFINITIONS,
  weaponDefinitions: WEAPON_DEFINITIONS,
  itemDefinitions: ITEM_DEFINITIONS,
  pickUpActionPointCost: 1,
  searchActionPointCost: 2,
  searchLootTables: SEARCH_LOOT_TABLES,
};
