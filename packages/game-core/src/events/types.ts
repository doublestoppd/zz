import type { BarrierId, ContainerId, ItemId, NoiseId, PlayerId, ZombieId } from "../ids.js";
import type { Position } from "../map/types.js";
import type {
  AmmoType,
  BarrierKind,
  ContainerCategory,
  GamePhase,
  ItemType,
  MatchOutcome,
  NoiseSourceType,
  WeaponType,
} from "../state/types.js";

/**
 * What happened, as emitted by the simulation. Clients use events for animation,
 * logs, and sound; tests assert on them. Events never carry presentation hints,
 * and the board is always fully described by the state snapshot without them.
 */
export type GameEvent =
  | PlayerMovedEvent
  | WeaponFiredEvent
  | WeaponSwungEvent
  | WeaponReloadedEvent
  | WeaponEquippedEvent
  | ZombieKnockedBackEvent
  | EntityDiedEvent
  | ItemPickedUpEvent
  | ItemUsedEvent
  | ContainerSearchedEvent
  | DoorOpenedEvent
  | DoorClosedEvent
  | BarrierForcedEvent
  | NoiseMadeEvent
  | ZombieInvestigatingEvent
  | PlayerHealedEvent
  | AmmoGainedEvent
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

/** A melee strike at an adjacent zombie. Damage follows as `entity_damaged`. */
export interface WeaponSwungEvent {
  readonly type: "weapon_swung";
  readonly playerId: PlayerId;
  readonly weaponType: WeaponType;
  readonly targetId: ZombieId;
  readonly actionPointsSpent: number;
}

export interface WeaponReloadedEvent {
  readonly type: "weapon_reloaded";
  readonly playerId: PlayerId;
  readonly loadedAmmo: number;
  readonly ammoType: AmmoType;
  /** Reserve of that ammunition kind after the reload. */
  readonly reserveAmmo: number;
  readonly actionPointsSpent: number;
}

/** A weapon item was picked up and put in its slot; the old weapon lies where the survivor stands. */
export interface WeaponEquippedEvent {
  readonly type: "weapon_equipped";
  readonly playerId: PlayerId;
  readonly weaponType: WeaponType;
  readonly replaced: WeaponType;
  readonly droppedItemId: ItemId;
}

/** A surviving zombie was shoved one tile by a melee hit. */
export interface ZombieKnockedBackEvent {
  readonly type: "zombie_knocked_back";
  readonly zombieId: ZombieId;
  readonly from: Position;
  readonly to: Position;
}

/** A zombie reached zero health and was removed from the board. */
export interface EntityDiedEvent {
  readonly type: "entity_died";
  readonly entityId: ZombieId;
}

export interface ItemPickedUpEvent {
  readonly type: "item_picked_up";
  readonly playerId: PlayerId;
  readonly itemId: ItemId;
  readonly itemType: ItemType;
  readonly actionPointsSpent: number;
}

/** A container was looted. `found` = `carried` + `dropped` (dropped items lie on its tile). */
export interface ContainerSearchedEvent {
  readonly type: "container_searched";
  readonly playerId: PlayerId;
  readonly containerId: ContainerId;
  readonly category: ContainerCategory;
  readonly found: readonly ItemType[];
  readonly carried: readonly ItemType[];
  readonly dropped: readonly ItemType[];
  readonly actionPointsSpent: number;
}

export interface DoorOpenedEvent {
  readonly type: "door_opened";
  readonly playerId: PlayerId;
  readonly barrierId: BarrierId;
  readonly position: Position;
  /** True when the door was locked and a key was spent. */
  readonly usedKey: boolean;
  readonly actionPointsSpent: number;
}

export interface DoorClosedEvent {
  readonly type: "door_closed";
  readonly playerId: PlayerId;
  readonly barrierId: BarrierId;
  readonly position: Position;
  readonly actionPointsSpent: number;
}

/** A locked door or a window was broken open; a `noise_made` event follows. */
export interface BarrierForcedEvent {
  readonly type: "barrier_forced";
  readonly playerId: PlayerId;
  readonly barrierId: BarrierId;
  readonly kind: BarrierKind;
  readonly position: Position;
  readonly actionPointsSpent: number;
}

/** A loud action happened; zombies within `intensity` tiles may investigate. */
export interface NoiseMadeEvent {
  readonly type: "noise_made";
  readonly noiseId: NoiseId;
  readonly position: Position;
  readonly intensity: number;
  readonly sourceType: NoiseSourceType;
}

/** A zombie that sees nobody picked a noise position to walk to. */
export interface ZombieInvestigatingEvent {
  readonly type: "zombie_investigating";
  readonly zombieId: ZombieId;
  readonly position: Position;
}

export interface ItemUsedEvent {
  readonly type: "item_used";
  readonly playerId: PlayerId;
  readonly itemType: ItemType;
  readonly actionPointsSpent: number;
}

export interface PlayerHealedEvent {
  readonly type: "player_healed";
  readonly playerId: PlayerId;
  readonly amount: number;
  readonly health: number;
}

export interface AmmoGainedEvent {
  readonly type: "ammo_gained";
  readonly playerId: PlayerId;
  readonly ammoType: AmmoType;
  readonly rounds: number;
  /** Reserve of that ammunition kind afterwards. */
  readonly reserveAmmo: number;
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
