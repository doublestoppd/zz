import type { ZombieDefinition, ZombieSpawnTableEntry, ZombieType } from "@zombie/game-core";

/**
 * One entry per `ZombieType`; the compiler rejects a missing one. Types differ by numbers
 * and by the behaviour flags on `ZombieDefinition`, never by code paths of their own.
 */
export const ZOMBIE_DEFINITIONS: Readonly<Record<ZombieType, ZombieDefinition>> = {
  /** The baseline: predictable, one tile a round. */
  walker: { maxHealth: 3, damage: 2, movesPerPhase: 1, sightRange: 6 },
  /** Fragile but fast and sharp-eyed: closes two tiles a round, so distance is no longer safety. */
  runner: { maxHealth: 2, damage: 1, movesPerPhase: 2, sightRange: 8 },
  /** A wall of meat: soaks a magazine, hits for a third of a survivor's health, cannot be shoved, and only steps in even rounds. */
  brute: { maxHealth: 8, damage: 4, movesPerPhase: 1, sightRange: 5, slow: true, unshakable: true },
};

/** Relative weights used when rolling which type stands at each zombie spawn. */
export const ZOMBIE_SPAWN_TABLE: readonly ZombieSpawnTableEntry[] = [
  { type: "walker", weight: 6 },
  { type: "runner", weight: 2 },
  { type: "brute", weight: 1 },
];
