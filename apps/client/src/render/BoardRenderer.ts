import Phaser from "phaser";
import {
  barrierOptions,
  legalFireTargets,
  legalMeleeTargets,
  legalMoveDestinations,
  objectiveZoneTiles,
  searchableContainersInReach,
  visibilityGrid,
  type Barrier,
  type BarrierId,
  type GameEvent,
  type GameMap,
  type GameState,
  type ItemId,
  type ContainerId,
  type ItemType,
  type NoiseSourceType,
  type PlayerId,
  type SearchableContainer,
  type PlayerState,
  type Position,
  type TileType,
  type ZombieId,
  type ZombieState,
  type ZombieType,
} from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import {
  AnimationPlayer,
  type AnimatedSprite,
  type AnimationStage,
  type TweenRequest,
} from "./AnimationPlayer.js";
import { planAnimations, type SoundName } from "./animationPlan.js";
import { TILE_SIZE, tileCenter, tileToPixel, type Pixel } from "./boardGeometry.js";

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
  container: 0x8d6e63,
  containerSearched: 0x4e4e4e,
  containerReachable: 0xffd54f,
  noiseGunfire: 0xffb74d,
  noiseMelee: 0xbcaaa4,
  noiseSearch: 0x90caf9,
  meleeTarget: 0xffa000,
  noiseForcedEntry: 0xff8a65,
  doorWood: 0x8d5a2b,
  doorLock: 0xffd54f,
  windowGlass: 0x9fd3e6,
  barrierAction: 0x80cbc4,
  fog: 0x05070a,
  barrierForce: 0xff8a65,
  activeRing: 0xffffff,
  absent: 0x777777,
  down: 0x5a5a5a,
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
  // Openings: the barrier sprite standing in the tile shows the door or window itself.
  door: COLOURS.floor,
  window: COLOURS.wall,
  wall: COLOURS.wall,
};

/** What each noise source looks like on the board; the compiler demands every source. */
const NOISE_COLOURS: Readonly<Record<NoiseSourceType, number>> = {
  gunfire: COLOURS.noiseGunfire,
  melee: COLOURS.noiseMelee,
  search: COLOURS.noiseSearch,
  forced_entry: COLOURS.noiseForcedEntry,
  alarm: 0xff5252,
};

const ITEM_LABELS: Readonly<Record<ItemType, string>> = {
  bandage: "b",
  medkit: "+",
  ammo_box: "A",
  shell_box: "S",
  rifle_clip: "R",
  key: "k",
  radio_parts: "!",
  pistol: "p",
  shotgun: "g",
  rifle: "r",
  knife: "n",
  bat: "t",
};

/** How each zombie type looks; the compiler demands an entry for every `ZombieType`. */
const ZOMBIE_STYLE: Readonly<
  Record<ZombieType, { readonly label: string; readonly colour: number; readonly size: number }>
> = {
  walker: { label: "Z", colour: 0x6a8f3c, size: 0.6 },
  runner: { label: "R", colour: 0xc9a227, size: 0.5 },
  brute: { label: "B", colour: 0x8e3b3b, size: 0.8 },
};

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

interface ContainerSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
}

/** Rebuilt whenever the barrier's state changes, so the shape always matches the state. */
interface BarrierSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly state: Barrier["state"];
}

/**
 * Draw order, bottom to top. Phaser sorts the display list by depth, so anything below the
 * tile layer's depth would be painted over by the opaque tiles and never seen.
 */
const DEPTH = {
  tiles: 0,
  furniture: 1, // containers, doors, windows
  highlights: 2,
  items: 3,
  fog: 4, // hides furniture and items out of sight; survivors and sound stay on top
  entities: 5,
  noises: 6,
  hover: 7,
  effects: 10,
} as const;

/**
 * Draws the board as a function of the latest GameState. The static map is drawn once;
 * player, zombie, and item markers are reconciled by id on every render so the picture
 * always matches the snapshot. Between snapshots, events are played as short tweens; a
 * new snapshot cancels any animation in progress and snaps to the truth.
 */
export class BoardRenderer implements AnimationStage {
  private readonly tileLayer: Phaser.GameObjects.Graphics;
  private readonly highlightLayer: Phaser.GameObjects.Graphics;
  private readonly effectLayer: Phaser.GameObjects.Graphics;
  private readonly hoverLayer: Phaser.GameObjects.Graphics;
  private readonly noiseLayer: Phaser.GameObjects.Graphics;
  private readonly fogLayer: Phaser.GameObjects.Graphics;
  private readonly players = new Map<PlayerId, EntitySprite>();
  private readonly zombies = new Map<ZombieId, EntitySprite>();
  private readonly items = new Map<ItemId, ItemSprite>();
  private readonly containers = new Map<ContainerId, ContainerSprite>();
  private readonly barriers = new Map<BarrierId, BarrierSprite>();
  private drawnMap: GameMap | undefined;
  private shownState: GameState | undefined;
  private readonly animation = new AnimationPlayer(this);
  private readonly reducedMotion: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sounds: SoundPlayer,
  ) {
    this.tileLayer = scene.add.graphics().setDepth(DEPTH.tiles);
    this.highlightLayer = scene.add.graphics().setDepth(DEPTH.highlights);
    this.noiseLayer = scene.add.graphics().setDepth(DEPTH.noises);
    this.fogLayer = scene.add.graphics().setDepth(DEPTH.fog);
    this.hoverLayer = scene.add.graphics().setDepth(DEPTH.hover);
    this.effectLayer = scene.add.graphics().setDepth(DEPTH.effects);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Shows `state`, playing `events` first unless animation is disabled or interrupted. */
  render(state: GameState, me: PlayerId | undefined, events: readonly GameEvent[]): void {
    this.scene.tweens.killAll();
    if (this.drawnMap !== state.map) this.drawMap(state);
    this.highlightLayer.clear();

    const steps = planAnimations(events, this.shownState, state, me);
    const toPlay = this.reducedMotion ? steps.filter((step) => step.kind === "sound") : steps;
    void this.animation.play(toPlay).then((completed) => {
      if (!completed) return;
      this.shownState = state;
      this.drawHighlights(state, me);
      this.drawNoises(state);
      this.drawFog(state);
      this.reconcileContainers(state);
      this.reconcileBarriers(state);
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

  // ---- AnimationStage: what the AnimationPlayer needs from Phaser ----

  spriteFor(id: PlayerId | ZombieId | ItemId): AnimatedSprite | undefined {
    const entity = this.players.get(id as PlayerId) ?? this.zombies.get(id as ZombieId);
    if (entity !== undefined) {
      return {
        target: entity.container,
        setBodyColour: (colour) => {
          entity.body.setFillStyle(
            colour === "damage"
              ? COLOURS.damageFlash
              : colour === "heal"
                ? COLOURS.healFlash
                : entity.colour,
          );
        },
      };
    }
    const item = this.items.get(id as ItemId);
    return item === undefined
      ? undefined
      : { target: item.container, setBodyColour: () => undefined };
  }

  tween(request: TweenRequest): Promise<void> {
    const { target, ...rest } = request;
    return new Promise((resolve) => {
      this.scene.tweens.add({
        ...rest,
        targets: target,
        onComplete: () => {
          resolve();
        },
        onStop: () => {
          resolve();
        },
      });
    });
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.scene.time.delayedCall(ms, resolve);
    });
  }

  drawShot(from: Pixel, to: Pixel): void {
    this.effectLayer.lineStyle(3, COLOURS.shot, 1);
    this.effectLayer.lineBetween(from.x, from.y, to.x, to.y);
  }

  clearEffects(): void {
    this.effectLayer.clear();
  }

  play(sound: SoundName): void {
    this.sounds.play(sound);
  }

  // ---- drawing and reconciliation ----

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
    for (const p of objectiveZoneTiles(state.objective)) {
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
    // Melee targets get an inner amber ring; a zombie both slots can hit shows both.
    g.lineStyle(3, COLOURS.meleeTarget);
    for (const z of legalMeleeTargets(state, player)) {
      const { x, y } = tileToPixel(z.position);
      g.strokeRect(x + 6, y + 6, TILE_SIZE - 12, TILE_SIZE - 12);
    }
    g.lineStyle(3, COLOURS.target);
    for (const z of legalFireTargets(state, player)) {
      const { x, y } = tileToPixel(z.position);
      g.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }
    g.lineStyle(3, COLOURS.containerReachable);
    for (const c of searchableContainersInReach(state, player)) {
      const { x, y } = tileToPixel(c.position);
      g.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }
    const doors = barrierOptions(state, player);
    g.lineStyle(3, COLOURS.barrierAction);
    for (const b of [...doors.open, ...doors.close]) {
      const { x, y } = tileToPixel(b.position);
      g.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    }
    g.lineStyle(3, COLOURS.barrierForce);
    for (const b of doors.force) {
      const { x, y } = tileToPixel(b.position);
      g.strokeRect(x + 5, y + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    }
  }

  /**
   * Marks every lingering noise: a dot on its tile and the square of tiles within earshot
   * (Chebyshev distance up to the intensity), fading as the noise's rounds run out.
   */
  private drawNoises(state: GameState): void {
    const g = this.noiseLayer;
    g.clear();
    for (const noise of state.noises) {
      const colour = NOISE_COLOURS[noise.sourceType];
      const alpha = Math.min(1, noise.remainingRounds / state.rules.noiseDurationRounds);
      const { x, y } = tileCenter(noise.position);
      g.fillStyle(colour, 0.8 * alpha);
      g.fillCircle(x, y, TILE_SIZE / 5);
      g.lineStyle(2, colour, 0.45 * alpha);
      const reach = noise.intensity * TILE_SIZE;
      g.strokeRect(
        x - TILE_SIZE / 2 - reach,
        y - TILE_SIZE / 2 - reach,
        TILE_SIZE + 2 * reach,
        TILE_SIZE + 2 * reach,
      );
    }
  }

  /**
   * Fog of war: tiles the team has never seen are blacked out, tiles seen before but not
   * now are dimmed (what lies there may be stale), tiles in view are clear. The rules that
   * decide the view live in game-core; this only paints their answer.
   */
  private drawFog(state: GameState): void {
    const g = this.fogLayer;
    g.clear();
    const visible = visibilityGrid(state);
    state.explored.forEach((row, y) => {
      row.forEach((known, x) => {
        if (visible[y]?.[x] === true) return;
        const { x: px, y: py } = tileToPixel({ x, y });
        // Unexplored is fully opaque: even a 4 % bleed of an item label would hint at loot.
        g.fillStyle(COLOURS.fog, known ? 0.55 : 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      });
    });
  }

  private reconcileContainers(state: GameState): void {
    const seen = new Set<ContainerId>();
    for (const container of state.containers) {
      seen.add(container.id);
      const sprite = this.containers.get(container.id) ?? this.createContainerSprite(container);
      const { x, y } = tileCenter(container.position);
      sprite.container.setPosition(x, y);
      sprite.body.setFillStyle(container.searched ? COLOURS.containerSearched : COLOURS.container);
      sprite.label.setText(container.searched ? "-" : "?");
    }
    for (const [id, sprite] of this.containers) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.containers.delete(id);
      }
    }
  }

  private createContainerSprite(container: SearchableContainer): ContainerSprite {
    const body = this.scene.add.rectangle(
      0,
      0,
      TILE_SIZE * 0.7,
      TILE_SIZE * 0.5,
      COLOURS.container,
    );
    const label = this.scene.add
      .text(0, 0, "?", { fontSize: "14px", color: "#ffffff" })
      .setOrigin(0.5);
    const group = this.scene.add.container(0, 0, [body, label]).setDepth(DEPTH.furniture);
    const sprite: ContainerSprite = { container: group, body, label };
    this.containers.set(container.id, sprite);
    return sprite;
  }

  private reconcileBarriers(state: GameState): void {
    const seen = new Set<BarrierId>();
    for (const barrier of state.barriers) {
      seen.add(barrier.id);
      const existing = this.barriers.get(barrier.id);
      if (existing?.state === barrier.state) continue;
      existing?.container.destroy();
      const { x, y } = tileCenter(barrier.position);
      this.barriers.set(barrier.id, {
        container: this.createBarrierSprite(barrier).setPosition(x, y),
        state: barrier.state,
      });
    }
    for (const [id, sprite] of this.barriers) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.barriers.delete(id);
      }
    }
  }

  /**
   * A door fills its opening when closed or locked (with a lock mark), shrinks to a leaf
   * along one edge when open, and lies splintered when broken; a window is a pane of glass
   * across the opening, shattered when broken.
   */
  private createBarrierSprite(barrier: Barrier): Phaser.GameObjects.Container {
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (barrier.kind === "door") {
      const shut = barrier.state === "closed" || barrier.state === "locked";
      const body = shut
        ? this.scene.add.rectangle(0, 0, TILE_SIZE * 0.9, TILE_SIZE * 0.9, COLOURS.doorWood)
        : this.scene.add.rectangle(
            -TILE_SIZE * 0.3,
            0,
            TILE_SIZE * 0.3,
            TILE_SIZE * 0.9,
            COLOURS.doorWood,
          );
      if (barrier.state === "broken") body.setAlpha(0.35);
      parts.push(body);
      if (barrier.state === "locked") {
        parts.push(
          this.scene.add.rectangle(0, 0, TILE_SIZE * 0.3, TILE_SIZE * 0.3, COLOURS.doorLock),
        );
      }
    } else {
      const pane = this.scene.add.rectangle(
        0,
        0,
        TILE_SIZE * 0.9,
        TILE_SIZE * 0.4,
        COLOURS.windowGlass,
      );
      if (barrier.state === "broken") pane.setAlpha(0.3);
      parts.push(pane);
    }
    if (barrier.state === "broken") {
      parts.push(
        this.scene.add.text(0, 0, "x", { fontSize: "16px", color: "#ffffff" }).setOrigin(0.5),
      );
    }
    return this.scene.add.container(0, 0, parts).setDepth(DEPTH.furniture);
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
    const container = this.scene.add.container(0, 0, [body, label]).setDepth(DEPTH.items);
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
    const container = this.scene.add
      .container(0, 0, [ring, body, label, healthBack, healthFill])
      .setDepth(DEPTH.entities);
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
    const style = ZOMBIE_STYLE[zombie.type];
    const body = this.scene.add.rectangle(
      0,
      0,
      TILE_SIZE * style.size,
      TILE_SIZE * style.size,
      style.colour,
    );
    const label = this.scene.add
      .text(0, 0, style.label, { fontSize: "16px", color: "#ffffff" })
      .setOrigin(0.5);
    const [healthBack, healthFill] = createHealthBar(this.scene);
    const container = this.scene.add
      .container(0, 0, [body, label, healthBack, healthFill])
      .setDepth(DEPTH.entities);
    const sprite: EntitySprite = { container, body, colour: style.colour, healthFill };
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
