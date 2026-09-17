import type { WeaponType } from "./types.js";

/** Starting statistics for a survivor. Values come from game-data. */
export interface SurvivorDefinition {
  readonly maxHealth: number;
  readonly maxActionPoints: number;
  readonly startingWeapon: WeaponType;
  /** Rounds carried outside the magazine at match start. */
  readonly startingReserveAmmo: number;
}

/** Statistics for one weapon type. Values come from game-data. */
export interface WeaponDefinition {
  readonly damage: number;
  /** Maximum Chebyshev distance (tiles, diagonals count as 1) to a target. */
  readonly range: number;
  readonly magazineSize: number;
  readonly fireActionPointCost: number;
  readonly reloadActionPointCost: number;
}

/** Statistics for one zombie type. Values come from game-data. */
export interface ZombieDefinition {
  readonly maxHealth: number;
  /** Health removed from a survivor by one attack. */
  readonly damage: number;
}
