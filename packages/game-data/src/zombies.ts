import type { ZombieDefinition, ZombieSpawnTableEntry, ZombieType } from "@zombie/game-core";

/** One entry per `ZombieType`; the compiler rejects a missing one. */
export const ZOMBIE_DEFINITIONS: Readonly<Record<ZombieType, ZombieDefinition>> = {
  walker: { maxHealth: 3, damage: 2, movesPerPhase: 1 },
};

/** Relative weights used when rolling which type stands at each zombie spawn. */
export const ZOMBIE_SPAWN_TABLE: readonly ZombieSpawnTableEntry[] = [{ type: "walker", weight: 1 }];
