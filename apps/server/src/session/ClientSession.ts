import type { PlayerId } from "@zombie/game-core";
import type { ServerMessage } from "@zombie/protocol";

/**
 * One connected socket. Runtime bookkeeping only; nothing here is game state.
 * `matchCode` and `playerId` are set while the session occupies a player slot.
 */
export interface ClientSession {
  readonly id: string;
  /** The peer address (or the first `X-Forwarded-For` entry behind a trusted proxy); for limits and logs only. */
  readonly address: string;
  send(message: ServerMessage): void;
  /** Closes the socket: 1008 when another socket takes over this slot, 1001 when the server goes away. */
  close(reason?: "replaced" | "going_away"): void;
  matchCode: string | undefined;
  playerId: PlayerId | undefined;
}
