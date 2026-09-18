import type { WeaponDefinition, WeaponType } from "@zombie/game-core";

/** One entry per `WeaponType`; the compiler rejects a missing one. */
export const WEAPON_DEFINITIONS: Readonly<Record<WeaponType, WeaponDefinition>> = {
  pistol: {
    damage: 2,
    range: 4,
    magazineSize: 6,
    fireActionPointCost: 1,
    reloadActionPointCost: 1,
    noise: 8,
  },
};
