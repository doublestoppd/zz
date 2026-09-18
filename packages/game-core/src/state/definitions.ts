import type { WeightedEntry } from "../random/weighted.js";
import type { ItemType, WeaponType, ZombieType } from "./types.js";

/** One roll of a search: an item, or nothing. */
export type SearchLoot = ItemType | "nothing";

/**
 * What a category of location yields. A search makes between `minRolls` and `maxRolls`
 * weighted draws; "nothing" draws are how a table expresses sparse locations.
 */
export interface SearchLootTable {
  readonly minRolls: number;
  readonly maxRolls: number;
  readonly entries: readonly WeightedEntry<SearchLoot>[];
}

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
export type LootTableEntry = WeightedEntry<ItemType>;

/** Statistics for one weapon type. Values come from game-data. */
export interface WeaponDefinition {
  readonly damage: number;
  /** Maximum Chebyshev distance (tiles, diagonals count as 1) to a target. */
  readonly range: number;
  readonly magazineSize: number;
  readonly fireActionPointCost: number;
  readonly reloadActionPointCost: number;
  /** Noise intensity (hearing radius in tiles) of one shot. */
  readonly noise: number;
}

/** Statistics for one zombie type. Values come from game-data. */
export interface ZombieDefinition {
  readonly maxHealth: number;
  /** Health removed from a survivor by one attack. */
  readonly damage: number;
  /** Tiles the zombie may step per zombie phase. An attack ends its activity for the phase. */
  readonly movesPerPhase: number;
  /** Chebyshev distance within which a survivor in line of sight is noticed. */
  readonly sightRange: number;
}

/** Relative chance of each zombie type appearing at a zombie spawn. */
export type ZombieSpawnTableEntry = WeightedEntry<ZombieType>;

/** Settings for the extraction game mode. Values come from game-data. */
export interface ExtractionSettings {
  readonly kind: "extraction";
  readonly holdoutRounds: number;
}

/** Which game mode a match plays and its settings. One member per mode. */
export type ObjectiveSettings = ExtractionSettings;
