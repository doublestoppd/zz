import type { GameEvent, GameState, PlayerId, RejectionReason } from "@zombie/game-core";
import type { LobbyMessage, ServerMessage } from "@zombie/protocol";
import type { ConnectionStatus } from "../net/GameConnection.js";
import { describeEvent } from "../ui/eventLog.js";

export interface Identity {
  readonly playerId: PlayerId;
  readonly matchCode: string;
  readonly rejoinToken: string;
}

/** Everything the UI renders from. Replaced wholesale on each change; never mutated. */
export interface ClientState {
  readonly connection: ConnectionStatus;
  readonly me: Identity | undefined;
  readonly lobby: LobbyMessage | undefined;
  readonly game: { readonly version: number; readonly state: GameState } | undefined;
  /** Sequence number of the command awaiting a server answer, if any. */
  readonly pendingSeq: number | undefined;
  readonly lastRejection: RejectionReason | undefined;
  readonly lastError: string | undefined;
  readonly log: readonly string[];
  /** Events that produced the current snapshot; the renderer animates them once. */
  readonly lastEvents: readonly GameEvent[];
}

const MAX_LOG_LINES = 60;

const INITIAL: ClientState = {
  connection: "closed",
  me: undefined,
  lobby: undefined,
  game: undefined,
  pendingSeq: undefined,
  lastRejection: undefined,
  lastError: undefined,
  log: [],
  lastEvents: [],
};

/**
 * Holds the latest authoritative snapshot and UI bookkeeping. Rendering is a function
 * of `get()`; events only add log lines and are never needed to reconstruct the board.
 */
export class ClientStore {
  private state: ClientState = INITIAL;
  private readonly listeners = new Set<(state: ClientState) => void>();

  get(): ClientState {
    return this.state;
  }

  subscribe(listener: (state: ClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setConnection(connection: ConnectionStatus): void {
    this.patch({ connection });
  }

  markPending(seq: number): void {
    this.patch({ pendingSeq: seq, lastRejection: undefined, lastError: undefined });
  }

  /** Forget the current identity (after leaving a match or a failed rejoin). */
  clearIdentity(): void {
    this.patch({
      me: undefined,
      lobby: undefined,
      game: undefined,
      pendingSeq: undefined,
      lastEvents: [],
    });
  }

  /** Clears the rejection text (the HUD calls this after a short delay). */
  clearRejection(): void {
    if (this.state.lastRejection !== undefined) this.patch({ lastRejection: undefined });
  }

  applyServerMessage(message: ServerMessage): void {
    switch (message.t) {
      case "joined":
        this.patch({
          me: {
            playerId: message.playerId,
            matchCode: message.matchCode,
            rejoinToken: message.rejoinToken,
          },
          lastError: undefined,
        });
        return;
      case "lobby":
        this.patch({ lobby: message });
        return;
      case "update": {
        if (this.state.game !== undefined && message.version < this.state.game.version) return;
        const lines = message.events.map((e: GameEvent) => describeEvent(e, message.state));
        this.patch({
          game: { version: message.version, state: message.state },
          pendingSeq: undefined,
          log: [...this.state.log, ...lines].slice(-MAX_LOG_LINES),
          lastEvents: message.events,
        });
        return;
      }
      case "rejected":
        if (message.seq === this.state.pendingSeq) {
          this.patch({ pendingSeq: undefined, lastRejection: message.reason });
        }
        return;
      case "error":
        this.patch({ lastError: message.message, pendingSeq: undefined });
        return;
    }
  }

  private patch(changes: Partial<ClientState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener(this.state);
  }
}
