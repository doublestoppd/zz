import type { GameEvent, GameMap, GameState, PlayerId } from "@zombie/game-core";
import type { LobbyMessage, RejectedMessage, ServerMessage } from "@zombie/protocol";
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
  /** The board for the current match, received once; `update` snapshots are joined to it. */
  readonly map: GameMap | undefined;
  readonly game: { readonly revision: number; readonly state: GameState } | undefined;
  /** Id of the command awaiting a server answer, if any. */
  readonly pendingCommandId: string | undefined;
  /** The last command rejection: the protocol category and, when given, the rule behind it. */
  readonly lastRejection: RejectedMessage | undefined;
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
  map: undefined,
  game: undefined,
  pendingCommandId: undefined,
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

  markPending(commandId: string): void {
    this.patch({ pendingCommandId: commandId, lastRejection: undefined, lastError: undefined });
  }

  /** The socket dropped: keep the match on screen, but no command can be pending any more. */
  markDisconnected(): void {
    this.patch({ pendingCommandId: undefined });
  }

  /** Forget the current identity (after leaving a match or a failed rejoin). */
  clearIdentity(): void {
    this.patch({
      me: undefined,
      lobby: undefined,
      map: undefined,
      game: undefined,
      pendingCommandId: undefined,
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
      case "map":
        this.patch({ map: message.map });
        return;
      case "update": {
        if (this.state.game !== undefined && message.revision < this.state.game.revision) return;
        const map = this.state.map;
        if (map === undefined) {
          console.warn("update received before the map; ignoring");
          return;
        }
        const state: GameState = { ...message.state, map };
        const lines = message.events.map((e: GameEvent) => describeEvent(e, state));
        // A snapshot settles the pending command only when it carries its id (or nothing is pending);
        // a server-originated update in between must not make the client send a second command.
        const settles =
          message.commandId === undefined || message.commandId === this.state.pendingCommandId;
        this.patch({
          game: { revision: message.revision, state },
          pendingCommandId: settles ? undefined : this.state.pendingCommandId,
          log: [...this.state.log, ...lines].slice(-MAX_LOG_LINES),
          lastEvents: message.events,
        });
        return;
      }
      case "rejected":
        if (message.commandId === this.state.pendingCommandId) {
          this.patch({ pendingCommandId: undefined, lastRejection: message });
        }
        return;
      case "error":
        this.patch({ lastError: message.message, pendingCommandId: undefined });
        return;
    }
  }

  private patch(changes: Partial<ClientState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener(this.state);
  }
}
