import type { WeaponDefinition, WeaponType } from "@zombie/game-core";

/**
 * One entry per `WeaponType`; the compiler rejects a missing one. Each weapon differs in
 * more than damage: reach, action economy, ammunition, and noise are the levers.
 */
export const WEAPON_DEFINITIONS: Readonly<Record<WeaponType, WeaponDefinition>> = {
  /** The reference firearm: balanced reach, one action point a shot, loud. */
  pistol: {
    kind: "firearm",
    damage: 2,
    range: 4,
    attackActionPointCost: 1,
    noise: 8,
    ammoType: "pistol_rounds",
    magazineSize: 6,
    reloadActionPointCost: 1,
  },
  /** Devastating up close, weak at two tiles, useless beyond; two shells; the loudest thing there is. */
  shotgun: {
    kind: "firearm",
    damage: 1,
    damageByDistance: [5, 3],
    range: 2,
    attackActionPointCost: 1,
    noise: 12,
    ammoType: "shells",
    magazineSize: 2,
    reloadActionPointCost: 1,
  },
  /** Reaches across a street and drops a walker in one round, but a shot costs two action points. */
  rifle: {
    kind: "firearm",
    damage: 4,
    range: 7,
    attackActionPointCost: 2,
    noise: 10,
    ammoType: "rifle_rounds",
    magazineSize: 5,
    reloadActionPointCost: 1,
  },
  /** Silent and cheap: a point of damage for one action point, no ammunition ever. */
  knife: { kind: "melee", damage: 1, range: 1, attackActionPointCost: 1, noise: 0 },
  /** Crowd control: hits harder, shoves the target back a tile, and is barely audible. */
  bat: { kind: "melee", damage: 2, range: 1, attackActionPointCost: 2, noise: 1, knockback: true },
};
