/**
 * Plain data that tunes the game. Imports only types from game-core so the dependency
 * arrow stays game-data -> game-core; game-core receives these values as parameters.
 */
export { DEFAULT_GAME_RULES } from "./rules.js";
export { SEARCH_LOOT_TABLES } from "./containers.js";
export { ITEM_DEFINITIONS, LOOT_TABLE } from "./items.js";
export { DEFAULT_OBJECTIVE } from "./objectives.js";
export { DEFAULT_SURVIVOR } from "./survivors.js";
export { SPECIALTY_DEFINITIONS } from "./specialties.js";
export { WEAPON_DEFINITIONS } from "./weapons.js";
export { ZOMBIE_DEFINITIONS, ZOMBIE_SPAWN_TABLE } from "./zombies.js";
