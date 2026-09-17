import type { ItemId, PlayerId, ZombieId } from "../ids.js";
import type { Position } from "../map/types.js";
import type { ItemType } from "../state/types.js";

/**
 * What a client may ask for. `playerId` is stamped by the server from the authenticated
 * session; it is never taken from the client payload (docs/NETWORK-PROTOCOL.md).
 */
export type PlayerCommand =
  MoveCommand | FireWeaponCommand | ReloadCommand | PickUpCommand | UseItemCommand | EndTurnCommand;

export interface MoveCommand {
  readonly type: "move";
  readonly playerId: PlayerId;
  /** Destination only. The server computes the path; the client never sends one. */
  readonly to: Position;
}

/** Fire the equipped weapon at a zombie. */
export interface FireWeaponCommand {
  readonly type: "fire_weapon";
  readonly playerId: PlayerId;
  readonly targetId: ZombieId;
}

/** Fill the equipped weapon's magazine from reserve ammunition. */
export interface ReloadCommand {
  readonly type: "reload";
  readonly playerId: PlayerId;
}

/** Pick up a ground item lying on the player's own tile. */
export interface PickUpCommand {
  readonly type: "pick_up";
  readonly playerId: PlayerId;
  readonly itemId: ItemId;
}

/** Use one carried item of the given type. */
export interface UseItemCommand {
  readonly type: "use_item";
  readonly playerId: PlayerId;
  readonly itemType: ItemType;
}

export interface EndTurnCommand {
  readonly type: "end_turn";
  readonly playerId: PlayerId;
}

/** Commands only the server may issue. They are never accepted from a socket. */
export type ServerCommand = SetPlayerPresenceCommand;

export interface SetPlayerPresenceCommand {
  readonly type: "set_player_presence";
  readonly playerId: PlayerId;
  readonly present: boolean;
}

export type Command = PlayerCommand | ServerCommand;
