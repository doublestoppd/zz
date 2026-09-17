import type { ZombieDefinition, ZombieType } from "@zombie/game-core";

/** One entry per `ZombieType`; the compiler rejects a missing one. */
export const ZOMBIE_DEFINITIONS: Readonly<Record<ZombieType, ZombieDefinition>> = {
  walker: { maxHealth: 3, damage: 2 },
};
