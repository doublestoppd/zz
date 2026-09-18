import Phaser from "phaser";
import { isInBounds, type Position } from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import { decideClickIntent } from "../input/clickIntent.js";
import { keyToCommand } from "../input/keyboard.js";
import type { CommandSender } from "../net/CommandSender.js";
import { BoardRenderer } from "../render/BoardRenderer.js";
import { pixelToTile } from "../render/boardGeometry.js";
import type { ClientStore } from "../state/ClientStore.js";

/** The only Phaser scene. Renders from the store and turns clicks and keys into commands. */
export class MatchScene extends Phaser.Scene {
  private board: BoardRenderer | undefined;
  private lastRenderedVersion = -1;

  constructor(
    private readonly store: ClientStore,
    private readonly sender: CommandSender,
    private readonly sounds: SoundPlayer,
  ) {
    super("match");
  }

  create(): void {
    this.board = new BoardRenderer(this, this.sounds);
    this.store.subscribe((client) => {
      if (client.game === undefined) {
        this.lastRenderedVersion = -1;
        return;
      }
      // Only a new snapshot triggers a render; other store changes (pending flags) do not.
      if (client.game.revision === this.lastRenderedVersion) return;
      this.lastRenderedVersion = client.game.revision;
      this.board?.render(client.game.state, client.me?.playerId, client.lastEvents);
    });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.handleClick(pointer);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      this.board?.showHover(this.tileUnder(pointer));
    });
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      this.handleKey(event);
    });
  }

  private tileUnder(pointer: Phaser.Input.Pointer): Position | undefined {
    const client = this.store.get();
    if (client.game === undefined) return undefined;
    const tile = pixelToTile({ x: pointer.worldX, y: pointer.worldY });
    return isInBounds(client.game.state.map, tile) ? tile : undefined;
  }

  private handleClick(pointer: Phaser.Input.Pointer): void {
    const client = this.store.get();
    const tile = this.tileUnder(pointer);
    if (client.game === undefined || client.me === undefined || tile === undefined) return;
    const command = decideClickIntent(client.game.state, client.me.playerId, tile);
    if (command !== undefined) this.sender.send(command);
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) return;
    const client = this.store.get();
    if (client.game === undefined || client.me === undefined) return;
    const command = keyToCommand(event.key, client.game.state, client.me.playerId);
    if (command === undefined) return;
    event.preventDefault();
    this.sender.send(command);
  }
}
