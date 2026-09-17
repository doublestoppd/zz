import type { ClientCommand } from "@zombie/protocol";
import type { ClientStore } from "../state/ClientStore.js";
import type { GameConnection } from "./GameConnection.js";

/**
 * Sends one gameplay command at a time. While a command is pending the next one is
 * dropped, so the UI never races the server in a turn-based game.
 */
export class CommandSender {
  private nextSeq = 1;

  constructor(
    private readonly connection: GameConnection,
    private readonly store: ClientStore,
  ) {}

  send(command: ClientCommand): void {
    if (this.store.get().pendingSeq !== undefined) return;
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.store.markPending(seq);
    const expectedVersion = this.store.get().game?.version ?? 0;
    this.connection.send({ t: "command", seq, expectedVersion, command });
  }
}
