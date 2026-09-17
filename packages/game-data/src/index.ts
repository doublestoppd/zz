/**
 * Plain data that tunes the game. Imports only types from game-core so the dependency
 * arrow stays game-data -> game-core; game-core receives these values as parameters.
 */
export { DEFAULT_GAME_RULES } from "./rules.js";
export { DEFAULT_SURVIVOR } from "./survivors.js";
export { ZOMBIE_DEFINITIONS } from "./zombies.js";
