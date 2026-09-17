import Phaser from "phaser";
import { isInBounds } from "@zombie/game-core";
import { decideClickIntent } from "../input/clickIntent.js";
import type { CommandSender } from "../net/CommandSender.js";
import { BoardRenderer } from "../render/BoardRenderer.js";
import { pixelToTile } from "../render/boardGeometry.js";
import type { ClientStore } from "../state/ClientStore.js";

/** The only Phaser scene. Renders from the store and turns tile clicks into commands. */
export class MatchScene extends Phaser.Scene {
  private board: BoardRenderer | undefined;

  constructor(
    private readonly store: ClientStore,
    private readonly sender: CommandSender,
  ) {
    super("match");
  }

  create(): void {
    this.board = new BoardRenderer(this);
    this.store.subscribe((client) => {
      if (client.game !== undefined) this.board?.render(client.game.state, client.me?.playerId);
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.handleClick(pointer);
    });
  }

  private handleClick(pointer: Phaser.Input.Pointer): void {
    const client = this.store.get();
    if (client.game === undefined || client.me === undefined) return;
    const tile = pixelToTile({ x: pointer.worldX, y: pointer.worldY });
    if (!isInBounds(client.game.state.map, tile)) return;
    const command = decideClickIntent(client.game.state, client.me.playerId, tile);
    if (command !== undefined) this.sender.send(command);
  }
}
