import type {
  GameEvent,
  GameState,
  PlayerCommand,
  PlayerId,
  RejectionReason,
} from "@zombie/game-core";

/** Bumped on any incompatible change. The server sends it in `joined`; clients compare. */
export const PROTOCOL_VERSION = 2;

/** Lobby limits shared by both sides so the client can validate before sending. */
export const PLAYER_NAME_MIN_LENGTH = 1;
export const PLAYER_NAME_MAX_LENGTH = 20;
export const MAX_PLAYERS = 4;

/**
 * A player command as the client sends it: without `playerId`, which the server stamps
 * from the session. Distributes over the union so each member loses only that field.
 */
export type ClientCommand = PlayerCommand extends infer C
  ? C extends PlayerCommand
    ? Omit<C, "playerId">
    : never
  : never;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | CreateMatchMessage
  | JoinMatchMessage
  | RejoinMatchMessage
  | StartMatchMessage
  | CommandMessage
  | LeaveMatchMessage;

/** Create a new lobby; the sender becomes host. Response: `joined` then `lobby`. */
export interface CreateMatchMessage {
  readonly t: "create_match";
  readonly playerName: string;
}

/** Join an existing lobby by code. Response: `joined` then `lobby` to everyone. */
export interface JoinMatchMessage {
  readonly t: "join_match";
  readonly matchCode: string;
  readonly playerName: string;
}

/** Reattach to a player slot after a disconnect. Response: `joined`, `lobby`, and `update` if started. */
export interface RejoinMatchMessage {
  readonly t: "rejoin_match";
  readonly matchCode: string;
  readonly rejoinToken: string;
}

/** Host only. Starts the match. Response: `update` to everyone. */
export interface StartMatchMessage {
  readonly t: "start_match";
}

/** A gameplay intent. Response: `update` to everyone, or `rejected` to the sender only. */
export interface CommandMessage {
  readonly t: "command";
  /**
   * Client-chosen and strictly increasing per connection; echoed back in `rejected` and
   * `error` so the client can match the answer. A repeat is refused as `DUPLICATE_COMMAND`.
   */
  readonly seq: number;
  /**
   * The `update.version` the client acted on. A mismatch is refused as `STALE_STATE`, so a
   * command composed against an old board never applies to a newer one.
   */
  readonly expectedVersion: number;
  readonly command: ClientCommand;
}

/** Leave the lobby or match. Response: `lobby` (or `update`) to the others. */
export interface LeaveMatchMessage {
  readonly t: "leave_match";
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  JoinedMessage | LobbyMessage | UpdateMessage | RejectedMessage | ErrorMessage;

export interface JoinedMessage {
  readonly t: "joined";
  readonly protocolVersion: number;
  readonly matchCode: string;
  readonly playerId: PlayerId;
  /** Secret for `rejoin_match`. Store it client-side; never show it to other players. */
  readonly rejoinToken: string;
}

export interface LobbyPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly present: boolean;
}

export interface LobbyMessage {
  readonly t: "lobby";
  readonly matchCode: string;
  readonly hostId: PlayerId;
  readonly maxPlayers: number;
  readonly started: boolean;
  readonly players: readonly LobbyPlayer[];
}

/** Full authoritative snapshot plus the events that produced it. Replaces any earlier state. */
export interface UpdateMessage {
  readonly t: "update";
  /** Increases by one per accepted command; a client may discard an update older than its latest. */
  readonly version: number;
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface RejectedMessage {
  readonly t: "rejected";
  readonly seq: number;
  readonly reason: RejectionReason;
}

export type ErrorCode =
  | "MALFORMED_MESSAGE"
  | "INVALID_PLAYER_NAME"
  | "MATCH_NOT_FOUND"
  | "MATCH_FULL"
  | "MATCH_ALREADY_STARTED"
  | "MATCH_NOT_STARTED"
  | "NOT_IN_MATCH"
  | "ALREADY_IN_MATCH"
  | "NOT_HOST"
  | "INVALID_REJOIN_TOKEN"
  | "DUPLICATE_COMMAND"
  | "STALE_STATE"
  | "RATE_LIMITED"
  | "SESSION_REPLACED";

/** Session-level problems (not gameplay rejections). Sent to the sender only. */
export interface ErrorMessage {
  readonly t: "error";
  readonly code: ErrorCode;
  readonly message: string;
  /** Present when the error answers a specific `command`, so the client can clear it. */
  readonly seq?: number;
}
