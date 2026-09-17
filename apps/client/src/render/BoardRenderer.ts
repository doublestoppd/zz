import Phaser from "phaser";
import {
  legalFireTargets,
  legalMoveDestinations,
  type GameEvent,
  type GameMap,
  type GameState,
  type ItemId,
  type ItemType,
  type PlayerId,
  type PlayerState,
  type Position,
  type TileType,
  type ZombieId,
  type ZombieState,
} from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import { planAnimations, type AnimationStep } from "./animationPlan.js";
import { TILE_SIZE, tileCenter, tileToPixel } from "./boardGeometry.js";

const COLOURS = {
  floor: 0x2b2f36,
  road: 0x3d434c,
  door: 0x6b4f2a,
  wall: 0x111318,
  grid: 0x3a3f47,
  extraction: 0x2f6f3e,
  highlight: 0x4a6fa5,
  hover: 0xffffff,
  target: 0xff5252,
  item: 0xe9c46a,
  activeRing: 0xffffff,
  absent: 0x777777,
  down: 0x5a5a5a,
  zombie: 0x6a8f3c,
  healthBack: 0x222222,
  healthFill: 0x4caf50,
  damageFlash: 0xff5252,
  healFlash: 0x69f0ae,
  shot: 0xfff59d,
  players: [0xe63946, 0xf4a261, 0x2a9d8f, 0xa06cd5],
} as const;

/** One colour per tile type; the compiler demands an entry for every `TileType`. */
const TILE_COLOURS: Readonly<Record<TileType, number>> = {
  floor: COLOURS.floor,
  road: COLOURS.road,
  door: COLOURS.door,
  wall: COLOURS.wall,
};

const ITEM_LABELS: Readonly<Record<ItemType, string>> = { medkit: "+", ammo_box: "A" };

/** Milliseconds per tile of movement, and for the shot and flash effects. */
const MOVE_MS_PER_TILE = 110;
const EFFECT_MS = 160;

interface EntitySprite {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Shape;
  readonly healthFill: Phaser.GameObjects.Rectangle;
  readonly colour: number;
  /** Only players have the active-turn ring. */
  readonly ring?: Phaser.GameObjects.Arc;
}

interface ItemSprite {
  readonly container: Phaser.GameObjects.Container;
}

/**
 * Draws the board as a function of the latest GameState. The static map is drawn once;
 * player, zombie, and item markers are reconciled by id on every render so the picture
 * always matches the snapshot. Between snapshots, events are played as short tweens; a
 * new snapshot cancels any animation in progress and snaps to the truth.
 */
export class BoardRenderer {
  private readonly tileLayer: Phaser.GameObjects.Graphics;
  private readonly highlightLayer: Phaser.GameObjects.Graphics;
  private readonly effectLayer: Phaser.GameObjects.Graphics;
  private readonly hoverLayer: Phaser.GameObjects.Graphics;
  private readonly players = new Map<PlayerId, EntitySprite>();
  private readonly zombies = new Map<ZombieId, EntitySprite>();
  private readonly items = new Map<ItemId, ItemSprite>();
  private drawnMap: GameMap | undefined;
  private shownState: GameState | undefined;
  private playbackToken = 0;
  private readonly reducedMotion: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sounds: SoundPlayer,
  ) {
    this.tileLayer = scene.add.graphics();
    this.highlightLayer = scene.add.graphics();
    this.hoverLayer = scene.add.graphics();
    this.effectLayer = scene.add.graphics().setDepth(10);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Shows `state`, playing `events` first unless animation is disabled or interrupted. */
  render(state: GameState, me: PlayerId | undefined, events: readonly GameEvent[]): void {
    this.playbackToken += 1;
    const token = this.playbackToken;
    this.scene.tweens.killAll();
    this.effectLayer.clear();
    if (this.drawnMap !== state.map) this.drawMap(state);
    this.highlightLayer.clear();

    const steps = this.reducedMotion ? [] : planAnimations(events, this.shownState, state, me);
    for (const step of steps) if (step.kind === "sound") this.sounds.play(step.name);
    void this.playSteps(steps, token).then(() => {
      if (token !== this.playbackToken) return;
      this.shownState = state;
      this.drawHighlights(state, me);
      this.reconcileItems(state);
      this.reconcilePlayers(state);
      this.reconcileZombies(state);
    });
  }

  /** Outlines the tile under the pointer; `undefined` clears it. */
  showHover(tile: Position | undefined): void {
    this.hoverLayer.clear();
    if (tile === undefined || this.shownState === undefined) return;
    const { x, y } = tileToPixel(tile);
    this.hoverLayer.lineStyle(2, COLOURS.hover, 0.6);
    this.hoverLayer.strokeRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  }

  private async playSteps(steps: readonly AnimationStep[], token: number): Promise<void> {
    for (const step of steps) {
      if (token !== this.playbackToken) return;
      switch (step.kind) {
        case "move": {
          const sprite =
            this.players.get(step.entityId as PlayerId) ??
            this.zombies.get(step.entityId as ZombieId);
          if (sprite === undefined) break;
          for (const tile of step.path) {
            const { x, y } = tileCenter(tile);
            await this.tween({ targets: sprite.container, x, y, duration: MOVE_MS_PER_TILE });
            if (token !== this.playbackToken) return;
          }
          break;
        }
        case "shot": {
          const from = tileCenter(step.from);
          const to = tileCenter(step.to);
          this.effectLayer.lineStyle(3, COLOURS.shot, 1);
          this.effectLayer.lineBetween(from.x, from.y, to.x, to.y);
          await this.wait(EFFECT_MS);
          this.effectLayer.clear();
          break;
        }
        case "flash": {
          const sprite =
            this.players.get(step.entityId as PlayerId) ??
            this.zombies.get(step.entityId as ZombieId);
          if (sprite === undefined) break;
          sprite.body.setFillStyle(
            step.tone === "damage" ? COLOURS.damageFlash : COLOURS.healFlash,
          );
          await this.tween({
            targets: sprite.container,
            scale: 1.25,
            duration: EFFECT_MS / 2,
            yoyo: true,
          });
          sprite.body.setFillStyle(sprite.colour);
          break;
        }
        case "vanish": {
          const sprite =
            this.zombies.get(step.entityId as ZombieId) ?? this.items.get(step.entityId as ItemId);
          if (sprite === undefined) break;
          await this.tween({
            targets: sprite.container,
            alpha: 0,
            scale: 0.3,
            duration: EFFECT_MS,
          });
          break;
        }
        case "sound":
          break;
      }
    }
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        ...config,
        onComplete: () => {
          resolve();
        },
        onStop: () => {
          resolve();
        },
      });
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.scene.time.delayedCall(ms, resolve);
    });
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
        g.fillStyle(TILE_COLOURS[tile.type]);
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
    const player = state.players.find((p) => p.id === me);
    if (player === undefined) return;
    g.lineStyle(3, COLOURS.target);
    for (const z of legalFireTargets(state, player)) {
      const { x, y } = tileToPixel(z.position);
      g.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }
  }

  private reconcileItems(state: GameState): void {
    const seen = new Set<ItemId>();
    for (const item of state.items) {
      seen.add(item.id);
      const sprite = this.items.get(item.id) ?? this.createItemSprite(item.id, item.type);
      const { x, y } = tileCenter(item.position);
      sprite.container.setPosition(x, y).setAlpha(1).setScale(1);
    }
    for (const [id, sprite] of this.items) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.items.delete(id);
      }
    }
  }

  private createItemSprite(id: ItemId, type: ItemType): ItemSprite {
    const body = this.scene.add.rectangle(0, 0, TILE_SIZE * 0.4, TILE_SIZE * 0.4, COLOURS.item);
    const label = this.scene.add
      .text(0, 0, ITEM_LABELS[type], { fontSize: "12px", color: "#000000" })
      .setOrigin(0.5);
    const container = this.scene.add.container(0, 0, [body, label]);
    const sprite: ItemSprite = { container };
    this.items.set(id, sprite);
    return sprite;
  }

  private reconcilePlayers(state: GameState): void {
    const active = state.phase.kind === "player_turn" ? state.phase.activePlayerId : undefined;
    const seen = new Set<PlayerId>();
    state.players.forEach((player) => {
      seen.add(player.id);
      const sprite = this.players.get(player.id) ?? this.createPlayerSprite(player, state);
      const { x, y } = tileCenter(player.position);
      sprite.container.setPosition(x, y).setScale(1).setAlpha(1);
      sprite.ring?.setVisible(player.id === active);
      sprite.body.setFillStyle(player.status === "down" ? COLOURS.down : sprite.colour);
      sprite.body.setAlpha(player.present ? 1 : 0.4);
      setHealthBar(sprite, player.health / player.maxHealth);
    });
    for (const [id, sprite] of this.players) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.players.delete(id);
      }
    }
  }

  private createPlayerSprite(player: PlayerState, state: GameState): EntitySprite {
    const index = state.turnOrder.indexOf(player.id);
    const colour = COLOURS.players[index % COLOURS.players.length] ?? COLOURS.absent;
    const ring = this.scene.add
      .circle(0, 0, TILE_SIZE * 0.42)
      .setStrokeStyle(3, COLOURS.activeRing);
    const body = this.scene.add.circle(0, 0, TILE_SIZE * 0.34, colour);
    const label = this.scene.add
      .text(0, 0, player.name.slice(0, 1).toUpperCase(), { fontSize: "16px", color: "#ffffff" })
      .setOrigin(0.5);
    const [healthBack, healthFill] = createHealthBar(this.scene);
    const container = this.scene.add.container(0, 0, [ring, body, label, healthBack, healthFill]);
    const sprite: EntitySprite = { container, body, ring, colour, healthFill };
    this.players.set(player.id, sprite);
    return sprite;
  }

  private reconcileZombies(state: GameState): void {
    const seen = new Set<ZombieId>();
    for (const zombie of state.zombies) {
      seen.add(zombie.id);
      const sprite = this.zombies.get(zombie.id) ?? this.createZombieSprite(zombie);
      const { x, y } = tileCenter(zombie.position);
      sprite.container.setPosition(x, y).setScale(1).setAlpha(1);
      sprite.body.setFillStyle(sprite.colour);
      setHealthBar(sprite, zombie.health / state.rules.zombieDefinitions[zombie.type].maxHealth);
    }
    for (const [id, sprite] of this.zombies) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.zombies.delete(id);
      }
    }
  }

  private createZombieSprite(zombie: ZombieState): EntitySprite {
    const body = this.scene.add.rectangle(0, 0, TILE_SIZE * 0.6, TILE_SIZE * 0.6, COLOURS.zombie);
    const label = this.scene.add
      .text(0, 0, "Z", { fontSize: "16px", color: "#ffffff" })
      .setOrigin(0.5);
    const [healthBack, healthFill] = createHealthBar(this.scene);
    const container = this.scene.add.container(0, 0, [body, label, healthBack, healthFill]);
    const sprite: EntitySprite = { container, body, colour: COLOURS.zombie, healthFill };
    this.zombies.set(zombie.id, sprite);
    return sprite;
  }
}

const HEALTH_BAR_WIDTH = TILE_SIZE * 0.7;
const HEALTH_BAR_Y = TILE_SIZE * 0.42;

function createHealthBar(
  scene: Phaser.Scene,
): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle] {
  const back = scene.add.rectangle(0, HEALTH_BAR_Y, HEALTH_BAR_WIDTH, 4, COLOURS.healthBack);
  const fill = scene.add
    .rectangle(-HEALTH_BAR_WIDTH / 2, HEALTH_BAR_Y, HEALTH_BAR_WIDTH, 4, COLOURS.healthFill)
    .setOrigin(0, 0.5);
  return [back, fill];
}

function setHealthBar(sprite: EntitySprite, fraction: number): void {
  sprite.healthFill.setDisplaySize(Math.max(0, Math.min(1, fraction)) * HEALTH_BAR_WIDTH, 4);
}
