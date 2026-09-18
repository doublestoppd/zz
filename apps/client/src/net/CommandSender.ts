import type { ClientCommand } from "@zombie/protocol";
import type { ClientStore } from "../state/ClientStore.js";
import type { GameConnection } from "./GameConnection.js";

/** A command id that is unique enough across tabs and reloads: a UUID where available. */
function newCommandId(counter: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `c${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Sends one gameplay command at a time, each with a fresh id and the revision it was
 * composed against. While a command is pending the next one is dropped, so the UI never
 * races the server in a turn-based game. A `STALE_REVISION` answer means this client
 * missed an update: it asks for a fresh snapshot rather than guessing.
 */
export class CommandSender {
  private counter = 0;

  constructor(
    private readonly connection: GameConnection,
    private readonly store: ClientStore,
  ) {
    connection.onMessage((message) => {
      if (message.t === "rejected" && message.reason === "STALE_REVISION") {
        connection.send({ t: "resync" });
      }
    });
  }

  send(command: ClientCommand): void {
    if (this.store.get().pendingCommandId !== undefined) return;
    this.counter += 1;
    const commandId = newCommandId(this.counter);
    this.store.markPending(commandId);
    const baseRevision = this.store.get().game?.revision ?? 0;
    this.connection.send({ t: "command", commandId, baseRevision, command });
  }
}
