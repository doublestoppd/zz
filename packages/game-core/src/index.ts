/**
 * Public API of the authoritative game core.
 *
 * Everything here is framework-free, deterministic, and operates on plain data.
 * Other packages import only from this file.
 */
export * from "./ids.js";
export * from "./map/index.js";
export * from "./state/index.js";
export * from "./random/index.js";
export * from "./pathfinding/index.js";
export * from "./rules/index.js";
export * from "./turn/index.js";
export * from "./commands/index.js";
export * from "./events/index.js";
