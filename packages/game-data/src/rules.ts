import type { GameRules } from "@zombie/game-core";
import { SEARCH_LOOT_TABLES } from "./containers.js";
import { ITEM_DEFINITIONS } from "./items.js";
import { SPECIALTY_DEFINITIONS } from "./specialties.js";
import { DYNAMIC_EVENT_RULES } from "./dynamicEvents.js";
import { THREAT_RULES } from "./threat.js";
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
  /** A search is a low local disturbance; a pistol shot is 8 (weapons.ts). */
  searchNoise: 2,
  /** A noise is heard in the zombie phase right after it and one more. */
  noiseDurationRounds: 2,
  openDoorActionPointCost: 1,
  closeDoorActionPointCost: 1,
  forceEntryActionPointCost: 2,
  /** Breaking a lock or a window is loud: between a search (2) and a pistol shot (8). */
  forceEntryNoise: 6,
  searchLootTables: SEARCH_LOOT_TABLES,
  specialtyDefinitions: SPECIALTY_DEFINITIONS,
  threat: THREAT_RULES,
  /** A survivor sees eight tiles, one more than the rifle reaches, so no target is ever a surprise. */
  visionRange: 8,
  dynamicEvents: DYNAMIC_EVENT_RULES,
};
