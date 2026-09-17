import type { GameRules } from "@zombie/game-core";
import { WEAPON_DEFINITIONS } from "./weapons.js";
import { ZOMBIE_DEFINITIONS } from "./zombies.js";

/** Numbers that tune the core rules. Change balance here, not in game-core. */
export const DEFAULT_GAME_RULES: GameRules = {
  moveCostPerTile: 1,
  zombieDefinitions: ZOMBIE_DEFINITIONS,
  weaponDefinitions: WEAPON_DEFINITIONS,
};
