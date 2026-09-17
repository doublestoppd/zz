import type { MatchId, PlayerId, ZombieId } from "../ids.js";
import type { GameMap, Position } from "../map/types.js";
import type { WeaponDefinition, ZombieDefinition } from "./definitions.js";

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
}

export type WeaponType = "pistol";

/** The one weapon a survivor carries. The inventory milestone will generalise this. */
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
  readonly weapon: EquippedWeapon;
  /** Rounds available for reloading. */
  readonly reserveAmmo: number;
  /**
   * False while the player is disconnected. Absent players are skipped in turn order.
   * Set only through the `set_player_presence` server command.
   */
  readonly present: boolean;
}

export type ZombieType = "walker";

export interface ZombieState {
  readonly id: ZombieId;
  readonly type: ZombieType;
  readonly position: Position;
  readonly health: number;
}

/** Discriminated union so a second game mode can be added as another member. */
export type ObjectiveState = ExtractionObjectiveState;

/**
 * Extraction: every standing survivor must be inside the zone at the end of a round, and
 * stay there for `holdoutRounds` further end-of-round checks (objectives/extraction.ts).
 */
export interface ExtractionObjectiveState {
  readonly kind: "extraction";
  readonly extractionZone: readonly Position[];
  /** Additional consecutive end-of-round checks the survivors must hold the zone for. */
  readonly holdoutRounds: number;
  /** Consecutive end-of-round checks passed so far. Resets when anyone leaves the zone. */
  readonly roundsHeld: number;
  readonly status: "in_progress" | "complete" | "failed";
}
