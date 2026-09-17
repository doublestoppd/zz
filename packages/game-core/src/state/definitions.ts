import type { ItemType, WeaponType } from "./types.js";

/** Starting statistics for a survivor. Values come from game-data. */
export interface SurvivorDefinition {
  readonly maxHealth: number;
  readonly maxActionPoints: number;
  readonly startingWeapon: WeaponType;
  /** Rounds carried outside the magazine at match start. */
  readonly startingReserveAmmo: number;
  /** Maximum number of items a survivor can carry. */
  readonly inventoryCapacity: number;
}

/** What using an item does. Add a member here for a new kind of effect. */
export type ItemEffect =
  | { readonly kind: "heal"; readonly amount: number }
  | { readonly kind: "ammo"; readonly rounds: number };

/** Statistics for one item type. Values come from game-data. */
export interface ItemDefinition {
  readonly effect: ItemEffect;
  readonly useActionPointCost: number;
}

/** Relative chance of each item type appearing at a loot spawn. */
export interface LootTableEntry {
  readonly type: ItemType;
  readonly weight: number;
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

/** Scenario settings for the extraction objective. Values come from game-data. */
export interface ExtractionSettings {
  readonly holdoutRounds: number;
}
