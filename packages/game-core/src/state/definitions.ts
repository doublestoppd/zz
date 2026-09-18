import type { WeightedEntry } from "../random/weighted.js";
import type { AmmoType, ItemType, ScenarioType, WeaponType, ZombieType } from "./types.js";

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

/**
 * Everything a specialty may change, as plain integers with 0 meaning "no change". Each
 * field is read at exactly one extension point in the rules (see `rules/specialties.ts`),
 * so a new modifier is a field here plus one read, never a scattered `if`.
 */
export interface SpecialtyModifiers {
  /** Added to `maxActionPoints` at match start (athlete). */
  readonly extraActionPoints: number;
  /** Added to every healing item's amount (paramedic). */
  readonly healBonus: number;
  /** Taken off a reload's action point cost, never below zero (officer). */
  readonly reloadActionPointDiscount: number;
  /** Taken off forced entry's action point cost, never below zero (mechanic). */
  readonly forceEntryActionPointDiscount: number;
  /** Taken off forced entry's noise intensity, never below zero (mechanic). */
  readonly forceEntryNoiseReduction: number;
  /** Taken off a search's action point cost, never below zero (scavenger). */
  readonly searchActionPointDiscount: number;
  /** Extra loot draws on every search (scavenger). */
  readonly searchExtraRolls: number;
}

/** A selectable specialty: a name, a one-line explanation for the UI, and its modifiers. */
export interface SpecialtyDefinition {
  readonly name: string;
  readonly description: string;
  readonly modifiers: SpecialtyModifiers;
}

/** Starting statistics for a survivor. Values come from game-data. */
export interface SurvivorDefinition {
  readonly maxHealth: number;
  readonly maxActionPoints: number;
  /** Must be a firearm. */
  readonly startingWeapon: WeaponType;
  /** Must be a melee weapon. */
  readonly startingMeleeWeapon: WeaponType;
  /** Rounds carried outside the magazine at match start, per kind of ammunition. */
  readonly startingReserveAmmo: Readonly<Record<AmmoType, number>>;
  /** Maximum number of items a survivor can carry. */
  readonly inventoryCapacity: number;
}

/** What using an item does. Add a member here for a new kind of effect. */
export type ItemEffect =
  | { readonly kind: "heal"; readonly amount: number }
  | { readonly kind: "ammo"; readonly ammoType: AmmoType; readonly rounds: number }
  /** Not usable on its own: spent by `open_door` on a locked door (rules/barriers.ts). */
  | { readonly kind: "key" }
  /** Not usable: carried for a scenario step that asks for it (objectives/steps.ts). */
  | { readonly kind: "objective" }
  /** Not usable on its own: picking the item up equips the weapon (rules/items.ts). */
  | { readonly kind: "weapon"; readonly weaponType: WeaponType };

/** Statistics for one item type. Values come from game-data. */
export interface ItemDefinition {
  readonly effect: ItemEffect;
  readonly useActionPointCost: number;
}

/** Relative chance of each item type appearing at a loot spawn. */
export type LootTableEntry = WeightedEntry<ItemType>;

/** What every weapon shares. Values come from game-data. */
interface WeaponBase {
  /** Health removed by one hit (a firearm's `damageByDistance` may override it by range). */
  readonly damage: number;
  /** Maximum Chebyshev distance (tiles, diagonals count as 1) to a target. Melee: 1. */
  readonly range: number;
  readonly attackActionPointCost: number;
  /** Noise intensity (hearing radius in tiles) of one attack; 0 is silent. */
  readonly noise: number;
}

/**
 * A gun: needs line of sight, a loaded magazine, and a kind of ammunition to reload from.
 * `damageByDistance` is the one firearm-specific behaviour so far: entry `i` is the damage
 * at Chebyshev distance `i + 1`, beyond the list `damage` applies (a shotgun's falloff).
 */
export interface FirearmDefinition extends WeaponBase {
  readonly kind: "firearm";
  readonly ammoType: AmmoType;
  readonly magazineSize: number;
  readonly reloadActionPointCost: number;
  readonly damageByDistance?: readonly number[];
}

/**
 * A hand weapon: hits an adjacent zombie, never needs ammunition. `knockback` is the one
 * melee-specific behaviour so far: a surviving target is shoved one tile directly away
 * from the attacker when that tile is free.
 */
export interface MeleeWeaponDefinition extends WeaponBase {
  readonly kind: "melee";
  readonly knockback?: boolean;
}

/**
 * Statistics for one weapon type. New weapons should be data first: add a field here (and
 * read it in `rules/combat.ts`) only when a number cannot express the difference.
 */
export type WeaponDefinition = FirearmDefinition | MeleeWeaponDefinition;

/** Statistics for one zombie type. Values come from game-data. */
export interface ZombieDefinition {
  readonly maxHealth: number;
  /** Health removed from a survivor by one attack. */
  readonly damage: number;
  /** Tiles the zombie may step per zombie phase. An attack ends its activity for the phase. */
  readonly movesPerPhase: number;
  /** Chebyshev distance within which a survivor in line of sight is noticed. */
  readonly sightRange: number;
  /**
   * Behaviour flags, composed rather than inherited. `slow`: steps only in even-numbered
   * rounds (it still attacks and remembers noises every round). `unshakable`: melee
   * knockback never moves it.
   */
  readonly slow?: boolean;
  readonly unshakable?: boolean;
}

/** Relative chance of each zombie type appearing at a zombie spawn. */
export type ZombieSpawnTableEntry = WeightedEntry<ZombieType>;

/**
 * How pressure rises over a match (rules/threat.ts). Levels run from 0 to `maxLevel`; the
 * per-level arrays must have `maxLevel + 1` entries.
 */
export interface ThreatRules {
  /** Rounds elapsed per level gained from time alone. */
  readonly roundsPerLevel: number;
  /** Accumulated noise intensity per level gained from noise. */
  readonly heatPerLevel: number;
  readonly maxLevel: number;
  /** Zombies spawned per reinforcement wave, by level. */
  readonly reinforcementCount: readonly number[];
  /** Rounds between waves, by level; 0 means no waves at that level. */
  readonly reinforcementInterval: readonly number[];
  /** Which types a wave rolls, by level. */
  readonly spawnTables: readonly (readonly ZombieSpawnTableEntry[])[];
  /** A wave never spawns within this Chebyshev distance of a standing survivor. */
  readonly spawnMinDistance: number;
}

/** A place a scenario can name; resolved to tiles against the layout at match creation. */
export type LocationRef = "extraction" | "safehouse";

/**
 * Reusable objective primitives. A scenario is an ordered list of these; each is checked
 * at the end of a round while it is the current step (objectives/steps.ts).
 */
export type ObjectiveStepSettings =
  | {
      readonly kind: "reach_location";
      readonly location: LocationRef;
      /** Further end-of-round checks everyone must stay for after first arriving. */
      readonly holdRounds: number;
      /** When set, a standing survivor inside the zone must carry this item. */
      readonly requireItem?: ItemType;
    }
  | { readonly kind: "acquire_item"; readonly itemType: ItemType }
  | { readonly kind: "survive_rounds"; readonly rounds: number };

/** A playable scenario: a name for the lobby and the steps that make it up. */
export interface ScenarioDefinition {
  readonly type: ScenarioType;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly ObjectiveStepSettings[];
}
