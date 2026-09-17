import type { PlayerId } from "../ids.js";
import type { Position } from "../map/types.js";

/**
 * What a client may ask for. `playerId` is stamped by the server from the authenticated
 * session; it is never taken from the client payload (docs/NETWORK-PROTOCOL.md).
 */
export type PlayerCommand = MoveCommand | EndTurnCommand;

export interface MoveCommand {
  readonly type: "move";
  readonly playerId: PlayerId;
  /** Destination only. The server computes the path; the client never sends one. */
  readonly to: Position;
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
