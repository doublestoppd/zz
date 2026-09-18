import type {
  BarrierId,
  ContainerId,
  ItemId,
  MatchId,
  NoiseId,
  PlayerId,
  ZombieId,
} from "../ids.js";
import type { GameMap, Position } from "../map/types.js";
import type {
  ItemDefinition,
  LocationRef,
  SearchLootTable,
  SpecialtyDefinition,
  ThreatRules,
  WeaponDefinition,
  ZombieDefinition,
} from "./definitions.js";

/**
 * Authoritative match state. Plain, JSON-serialisable data only: no class instances,
 * Maps, Sets, functions, or framework objects. The server broadcasts this whole object
 * as the synchronisation snapshot, and tests build it from object literals.
 */
export interface GameState {
  readonly matchId: MatchId;
  /** The seed the match was created with. Map and gameplay streams derive from it. */
  readonly seed: number;
  /** Current cursor of the gameplay Rng. Updated by every function that consumes randomness. */
  readonly rngState: number;
  /** Numbers that tune the rules. Supplied from game-data at match creation, then frozen. */
  readonly rules: GameRules;
  /** Starts at 1 and increases after each end-of-round phase. */
  readonly round: number;
  readonly phase: GamePhase;
  /** Fixed at match start. Who is skipped is computed from player state, never by editing this. */
  readonly turnOrder: readonly PlayerId[];
  readonly map: GameMap;
  readonly players: readonly PlayerState[];
  readonly zombies: readonly ZombieState[];
  /** Items lying on the ground. Picking one up moves it into a survivor's inventory. */
  readonly items: readonly GroundItem[];
  /** Searchable objects inside buildings. Each yields loot once. */
  readonly containers: readonly SearchableContainer[];
  /** Doors and windows: the only dynamic terrain. One per `door`/`window` tile. */
  readonly barriers: readonly Barrier[];
  /** Recent loud actions that zombies may investigate. Expire after `noiseDurationRounds`. */
  readonly noises: readonly NoiseEvent[];
  /** Counter behind noise ids, so ids are unique and creation order is recoverable. */
  readonly noiseCounter: number;
  /** Counter behind zombie ids; reinforcements continue the sequence. */
  readonly zombieCounter: number;
  /** Current threat level, 0 to `rules.threat.maxLevel`; recomputed at every end of round. */
  readonly threat: number;
  /** Sum of every noise intensity made so far; one of the threat inputs. */
  readonly heat: number;
  /** Where reinforcement waves may appear (the layout's zombie spawns). */
  readonly reinforcementSpawns: readonly Position[];
  readonly objective: ObjectiveState;
}

/**
 * The match state machine (docs/GAME-RULES.md §Turn sequence).
 * `activePlayerId` lives inside `player_turn` so "it is a player's turn" and
 * "someone is the active player" can never disagree.
 */
export type GamePhase =
  | { readonly kind: "player_turn"; readonly activePlayerId: PlayerId }
  | { readonly kind: "zombie_phase" }
  | { readonly kind: "end_of_round" }
  | { readonly kind: "finished"; readonly outcome: MatchOutcome };

export type MatchOutcome = "victory" | "defeat";

export interface GameRules {
  /** Action points spent per tile moved. */
  readonly moveCostPerTile: number;
  /** Statistics per zombie type. Adding a `ZombieType` without an entry fails to compile. */
  readonly zombieDefinitions: Readonly<Record<ZombieType, ZombieDefinition>>;
  /** Statistics per weapon type. Adding a `WeaponType` without an entry fails to compile. */
  readonly weaponDefinitions: Readonly<Record<WeaponType, WeaponDefinition>>;
  /** Statistics per item type. Adding an `ItemType` without an entry fails to compile. */
  readonly itemDefinitions: Readonly<Record<ItemType, ItemDefinition>>;
  /** Action points to pick an item up from the ground. */
  readonly pickUpActionPointCost: number;
  /** Action points to search a container. */
  readonly searchActionPointCost: number;
  /** Noise intensity (hearing radius in tiles) made by a search; 0 means silent. */
  readonly searchNoise: number;
  /** Zombie phases a noise stays audible for, counting the one right after it is made. */
  readonly noiseDurationRounds: number;
  /** Action points to open a closed (or, with a key, locked) door. */
  readonly openDoorActionPointCost: number;
  /** Action points to close an open door. */
  readonly closeDoorActionPointCost: number;
  /** Action points to break a locked door or an intact window. */
  readonly forceEntryActionPointCost: number;
  /** Noise intensity (hearing radius in tiles) of forced entry; 0 means silent. */
  readonly forceEntryNoise: number;
  /** What each kind of location yields when searched. */
  readonly searchLootTables: Readonly<Record<ContainerCategory, SearchLootTable>>;
  /** What each specialty changes. Adding a `SpecialtyType` without an entry fails to compile. */
  readonly specialtyDefinitions: Readonly<Record<SpecialtyType, SpecialtyDefinition>>;
  /** How pressure escalates over the match. */
  readonly threat: ThreatRules;
}

/** Runtime list of location kinds; loot tables and templates are keyed by it. */
export const CONTAINER_CATEGORIES = ["home", "clinic", "police", "shop"] as const;
export type ContainerCategory = (typeof CONTAINER_CATEGORIES)[number];

/** A cabinet, shelf, locker, or similar. Standing on or next to it allows a search. */
export interface SearchableContainer {
  readonly id: ContainerId;
  readonly category: ContainerCategory;
  readonly position: Position;
  /** True once looted; a container never yields twice. */
  readonly searched: boolean;
}

/** What a barrier is. Doors open and close; windows only stand or break. */
export type BarrierKind = "door" | "window";

/**
 * The state of a door or window. A door is `open`, `closed`, `locked`, or `broken`; a
 * window is `closed` (intact) or `broken`. `broken` is permanent and behaves like open.
 */
export type BarrierState = "open" | "closed" | "locked" | "broken";

/** A door or window standing in an opening tile. `rules/barriers.ts` reads its state. */
export interface Barrier {
  readonly id: BarrierId;
  readonly kind: BarrierKind;
  readonly position: Position;
  readonly state: BarrierState;
}

/** Runtime list of item types; the type is derived from it so decoders and UIs can iterate. */
export const ITEM_TYPES = [
  "bandage",
  "medkit",
  "ammo_box",
  "shell_box",
  "rifle_clip",
  "key",
  "radio_parts",
  "pistol",
  "shotgun",
  "rifle",
  "knife",
  "bat",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export interface GroundItem {
  readonly id: ItemId;
  readonly type: ItemType;
  readonly position: Position;
}

/** Runtime list of weapon types; `WEAPON_TYPES` lets decoders and UIs iterate. */
export const WEAPON_TYPES = ["pistol", "shotgun", "rifle", "knife", "bat"] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** Kinds of ammunition. Each firearm uses one; reserves are kept per kind. */
export const AMMO_TYPES = ["pistol_rounds", "shells", "rifle_rounds"] as const;
export type AmmoType = (typeof AMMO_TYPES)[number];

/** The firearm a survivor holds and what is in its magazine. */
export interface EquippedWeapon {
  readonly type: WeaponType;
  readonly loadedAmmo: number;
}

/** `down` survivors stay on the board but cannot act. Later milestones add `extracted`. */
export type PlayerStatus = "active" | "down";

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly position: Position;
  readonly health: number;
  readonly maxHealth: number;
  readonly actionPoints: number;
  readonly maxActionPoints: number;
  readonly status: PlayerStatus;
  /** Chosen in the lobby; its modifiers are read at the rules' extension points. */
  readonly specialty: SpecialtyType;
  /** The firearm slot: always a weapon whose definition has `kind: "firearm"`. */
  readonly weapon: EquippedWeapon;
  /** The melee slot: always a weapon whose definition has `kind: "melee"`. Never needs ammo. */
  readonly meleeWeapon: WeaponType;
  /** Rounds available for reloading, per kind of ammunition. */
  readonly reserveAmmo: Readonly<Record<AmmoType, number>>;
  /** Carried items, unordered, at most `inventoryCapacity` from the survivor definition. */
  readonly inventory: readonly ItemType[];
  readonly inventoryCapacity: number;
  /**
   * False while the player is disconnected. Absent players are skipped in turn order.
   * Set only through the `set_player_presence` server command.
   */
  readonly present: boolean;
}

/** Runtime list of survivor specialties; the lobby offers them and decoders check them. */
export const SPECIALTY_TYPES = [
  "survivor",
  "paramedic",
  "officer",
  "mechanic",
  "athlete",
  "scavenger",
] as const;
export type SpecialtyType = (typeof SPECIALTY_TYPES)[number];

/** Runtime list of zombie types; `ZOMBIE_TYPES` lets spawn tables and UIs iterate. */
export const ZOMBIE_TYPES = ["walker", "runner", "brute"] as const;
export type ZombieType = (typeof ZOMBIE_TYPES)[number];

export interface ZombieState {
  readonly id: ZombieId;
  readonly type: ZombieType;
  readonly position: Position;
  readonly health: number;
  /**
   * A remembered noise position the zombie is walking to. Kept until it arrives, sees a
   * survivor, or finds the spot unreachable, so a sound keeps drawing it after the source
   * has moved on.
   */
  readonly investigating?: Position;
}

/** What made a noise. Drives client presentation and, later, per-source rules. */
export type NoiseSourceType = "gunfire" | "melee" | "search" | "forced_entry";

/**
 * A sound remembered by the world. `intensity` is the hearing radius in tiles (Chebyshev):
 * a zombie hears it when its distance is at most the intensity. `remainingRounds` counts
 * the zombie phases it will still be evaluated in.
 */
export interface NoiseEvent {
  readonly id: NoiseId;
  readonly position: Position;
  readonly intensity: number;
  readonly remainingRounds: number;
  readonly sourceType: NoiseSourceType;
}

/** Runtime list of scenarios; the lobby offers them and decoders check them. */
export const SCENARIO_TYPES = ["extraction", "retrieval"] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];

/**
 * One objective primitive with its progress. Settings live in `ScenarioDefinition`; the
 * runtime copy carries resolved tiles and counters so the snapshot is self-contained.
 */
export type ObjectiveStep =
  | {
      readonly kind: "reach_location";
      readonly location: LocationRef;
      readonly zone: readonly Position[];
      readonly holdRounds: number;
      /** Consecutive end-of-round checks passed so far. Resets when the condition breaks. */
      readonly roundsHeld: number;
      readonly requireItem?: ItemType;
    }
  | { readonly kind: "acquire_item"; readonly itemType: ItemType }
  | { readonly kind: "survive_rounds"; readonly rounds: number; readonly roundsSurvived: number };

/** The scenario's steps in order and which one is active (objectives/objective.ts). */
export interface ObjectiveState {
  readonly scenario: ScenarioType;
  readonly steps: readonly ObjectiveStep[];
  /** Index of the active step; equal to `steps.length` once complete. */
  readonly current: number;
  readonly status: "in_progress" | "complete" | "failed";
}
