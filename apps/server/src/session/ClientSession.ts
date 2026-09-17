import type { PlayerId } from "@zombie/game-core";
import type { ServerMessage } from "@zombie/protocol";

/**
 * One connected socket. Runtime bookkeeping only; nothing here is game state.
 * `matchCode` and `playerId` are set while the session occupies a player slot.
 */
export interface ClientSession {
  readonly id: string;
  send(message: ServerMessage): void;
  matchCode: string | undefined;
  playerId: PlayerId | undefined;
}
