import type { PlayerId, ZombieId } from "../ids.js";
import type { Position } from "../map/types.js";
import type { GamePhase, MatchOutcome, WeaponType } from "../state/types.js";

/**
 * What happened, as emitted by the simulation. Clients use events for animation,
 * logs, and sound; tests assert on them. Events never carry presentation hints,
 * and the board is always fully described by the state snapshot without them.
 */
export type GameEvent =
  | PlayerMovedEvent
  | WeaponFiredEvent
  | WeaponReloadedEvent
  | EntityDiedEvent
  | TurnEndedEvent
  | TurnStartedEvent
  | RoundStartedEvent
  | PhaseChangedEvent
  | PlayerPresenceChangedEvent
  | ZombieMovedEvent
  | ZombieAttackedEvent
  | EntityDamagedEvent
  | PlayerDownedEvent
  | ExtractionProgressEvent
  | MatchEndedEvent;

export interface PlayerMovedEvent {
  readonly type: "player_moved";
  readonly playerId: PlayerId;
  /** Tiles stepped onto in order, excluding the origin. */
  readonly path: readonly Position[];
  readonly actionPointsSpent: number;
}

export interface WeaponFiredEvent {
  readonly type: "weapon_fired";
  readonly playerId: PlayerId;
  readonly weaponType: WeaponType;
  readonly targetId: ZombieId;
  readonly actionPointsSpent: number;
}

export interface WeaponReloadedEvent {
  readonly type: "weapon_reloaded";
  readonly playerId: PlayerId;
  readonly loadedAmmo: number;
  readonly reserveAmmo: number;
  readonly actionPointsSpent: number;
}

/** A zombie reached zero health and was removed from the board. */
export interface EntityDiedEvent {
  readonly type: "entity_died";
  readonly entityId: ZombieId;
}

export interface TurnEndedEvent {
  readonly type: "turn_ended";
  readonly playerId: PlayerId;
}

export interface TurnStartedEvent {
  readonly type: "turn_started";
  readonly playerId: PlayerId;
  readonly round: number;
}

export interface RoundStartedEvent {
  readonly type: "round_started";
  readonly round: number;
}

export interface PhaseChangedEvent {
  readonly type: "phase_changed";
  readonly phase: GamePhase;
}

export interface PlayerPresenceChangedEvent {
  readonly type: "player_presence_changed";
  readonly playerId: PlayerId;
  readonly present: boolean;
}

export interface ZombieMovedEvent {
  readonly type: "zombie_moved";
  readonly zombieId: ZombieId;
  readonly from: Position;
  readonly to: Position;
}

export interface ZombieAttackedEvent {
  readonly type: "zombie_attacked";
  readonly zombieId: ZombieId;
  readonly targetId: PlayerId;
  readonly damage: number;
}

/** Health after mitigation has been removed. `remainingHealth` is the entity's new health. */
export interface EntityDamagedEvent {
  readonly type: "entity_damaged";
  readonly entityId: PlayerId | ZombieId;
  readonly damage: number;
  readonly remainingHealth: number;
}

/** A survivor reached zero health. They stay on the board but can no longer act. */
export interface PlayerDownedEvent {
  readonly type: "player_downed";
  readonly playerId: PlayerId;
}

/** Emitted at end of round whenever the extraction hold count changes. */
export interface ExtractionProgressEvent {
  readonly type: "extraction_progress";
  readonly roundsHeld: number;
  readonly holdoutRounds: number;
}

export interface MatchEndedEvent {
  readonly type: "match_ended";
  readonly outcome: MatchOutcome;
}
