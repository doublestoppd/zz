import Phaser from "phaser";
import {
  legalMoveDestinations,
  type GameMap,
  type GameState,
  type PlayerId,
  type PlayerState,
} from "@zombie/game-core";
import { TILE_SIZE, tileCenter, tileToPixel } from "./boardGeometry.js";

const COLOURS = {
  floor: 0x2b2f36,
  wall: 0x111318,
  grid: 0x3a3f47,
  extraction: 0x2f6f3e,
  highlight: 0x4a6fa5,
  activeRing: 0xffffff,
  absent: 0x777777,
  players: [0xe63946, 0xf4a261, 0x2a9d8f, 0xa06cd5],
} as const;

interface PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly circle: Phaser.GameObjects.Arc;
  readonly ring: Phaser.GameObjects.Arc;
}

/**
 * Draws the board as a function of the latest GameState. The static map is drawn once;
 * player markers are reconciled by id on every render so the picture always matches the
 * snapshot even if an event was missed.
 */
export class BoardRenderer {
  private readonly tileLayer: Phaser.GameObjects.Graphics;
  private readonly highlightLayer: Phaser.GameObjects.Graphics;
  private readonly players = new Map<PlayerId, PlayerSprite>();
  private drawnMap: GameMap | undefined;

  constructor(private readonly scene: Phaser.Scene) {
    this.tileLayer = scene.add.graphics();
    this.highlightLayer = scene.add.graphics();
  }

  render(state: GameState, me: PlayerId | undefined): void {
    if (this.drawnMap !== state.map) this.drawMap(state);
    this.drawHighlights(state, me);
    this.reconcilePlayers(state);
  }

  private drawMap(state: GameState): void {
    const { map } = state;
    this.drawnMap = map;
    this.scene.scale.resize(map.width * TILE_SIZE, map.height * TILE_SIZE);
    const g = this.tileLayer;
    g.clear();
    map.tiles.forEach((row, y) => {
      row.forEach((tile, x) => {
        const { x: px, y: py } = tileToPixel({ x, y });
        g.fillStyle(tile.walkable ? COLOURS.floor : COLOURS.wall);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        g.lineStyle(1, COLOURS.grid);
        g.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      });
    });
    for (const p of state.objective.extractionZone) {
      const { x: px, y: py } = tileToPixel(p);
      g.fillStyle(COLOURS.extraction);
      g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  private drawHighlights(state: GameState, me: PlayerId | undefined): void {
    const g = this.highlightLayer;
    g.clear();
    if (
      me === undefined ||
      state.phase.kind !== "player_turn" ||
      state.phase.activePlayerId !== me
    ) {
      return;
    }
    g.fillStyle(COLOURS.highlight, 0.45);
    for (const p of legalMoveDestinations(state, me)) {
      const { x, y } = tileToPixel(p);
      g.fillRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    }
  }

  private reconcilePlayers(state: GameState): void {
    const active = state.phase.kind === "player_turn" ? state.phase.activePlayerId : undefined;
    const seen = new Set<PlayerId>();
    state.players.forEach((player) => {
      seen.add(player.id);
      const sprite = this.players.get(player.id) ?? this.createPlayerSprite(player, state);
      const { x, y } = tileCenter(player.position);
      sprite.container.setPosition(x, y);
      sprite.ring.setVisible(player.id === active);
      sprite.circle.setAlpha(player.present ? 1 : 0.4);
    });
    for (const [id, sprite] of this.players) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.players.delete(id);
      }
    }
  }

  private createPlayerSprite(player: PlayerState, state: GameState): PlayerSprite {
    const index = state.turnOrder.indexOf(player.id);
    const colour = COLOURS.players[index % COLOURS.players.length] ?? COLOURS.absent;
    const ring = this.scene.add
      .circle(0, 0, TILE_SIZE * 0.42)
      .setStrokeStyle(3, COLOURS.activeRing);
    const circle = this.scene.add.circle(0, 0, TILE_SIZE * 0.34, colour);
    const label = this.scene.add
      .text(0, 0, player.name.slice(0, 1).toUpperCase(), { fontSize: "16px", color: "#ffffff" })
      .setOrigin(0.5);
    const container = this.scene.add.container(0, 0, [ring, circle, label]);
    const sprite: PlayerSprite = { container, circle, ring };
    this.players.set(player.id, sprite);
    return sprite;
  }
}
