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
} from "@zombie/game-core";
import type { SoundPlayer } from "../audio/SoundPlayer.js";
import {
  AnimationPlayer,
  type AnimatedSprite,
  type AnimationStage,
  type TweenRequest,
} from "./AnimationPlayer.js";
import { planAnimations, type SoundName } from "./animationPlan.js";
import {
  characterKey,
  CONTAINER_KEYS,
  FURNITURE_KEYS,
  ITEM_KEYS,
  SOURCE_TILE,
  SPECIALTY_CHARACTER,
  TILE_KEYS,
  variant,
  WEAPON_POSE,
  ZOMBIE_CHARACTER,
  ZOMBIE_LOOK,
} from "./assets.js";
import { TILE_SIZE, tileCenter, tileToPixel, type Pixel } from "./boardGeometry.js";
import { outdoorGrid } from "./outdoors.js";

const COLOURS = {
  extraction: 0x2f6f3e,
  highlight: 0x4a6fa5,
  hover: 0xffffff,
  target: 0xff5252,
  containerReachable: 0xffd54f,
  noiseGunfire: 0xffb74d,
  noiseMelee: 0xbcaaa4,
  noiseSearch: 0x90caf9,
  meleeTarget: 0xffa000,
  noiseForcedEntry: 0xff8a65,
  doorLock: 0xffd54f,
  barrierAction: 0x80cbc4,
  fog: 0x05070a,
  barrierForce: 0xff8a65,
  activeRing: 0xffffff,
  absent: 0x777777,
  down: 0x6a6a6a,
  healthBack: 0x222222,
  healthFill: 0x4caf50,
  damageFlash: 0xff5252,
  healFlash: 0x69f0ae,
  shot: 0xfff59d,
  players: [0xe63946, 0xf4a261, 0x2a9d8f, 0xa06cd5],
} as const;

/** What each noise source looks like on the board; the compiler demands every source. */
const NOISE_COLOURS: Readonly<Record<NoiseSourceType, number>> = {
  gunfire: COLOURS.noiseGunfire,
  melee: COLOURS.noiseMelee,
  search: COLOURS.noiseSearch,
  forced_entry: COLOURS.noiseForcedEntry,
  alarm: 0xff5252,
};

/** Characters in the pack face right; the figure turns toward its last step. */
const FACING_RIGHT = 0;

/** Figures are drawn from 64 px sources onto `TILE_SIZE` tiles. */
const FIGURE_SCALE = TILE_SIZE / SOURCE_TILE;

interface EntitySprite {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Image;
  readonly healthFill: Phaser.GameObjects.Rectangle;
  /** The tint at rest: white for a figure drawn as is, something else for a variant. */
  readonly tint: number;
  /** Only players have the active-turn ring and a name. */
  readonly ring?: Phaser.GameObjects.Arc;
  /** Where the figure last looked, in radians; kept across renders. */
  facing: number;
}

interface ItemSprite {
  readonly container: Phaser.GameObjects.Container;
}

interface ContainerSprite {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Image;
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
  zone: 0.5, // the extraction zone overlay
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
  private tileLayer: Phaser.GameObjects.RenderTexture | undefined;
  private readonly zoneLayer: Phaser.GameObjects.Graphics;
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
    this.zoneLayer = scene.add.graphics().setDepth(DEPTH.zone);
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
          entity.body.setTint(
            colour === "damage"
              ? COLOURS.damageFlash
              : colour === "heal"
                ? COLOURS.healFlash
                : entity.tint,
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

  /**
   * The static board, drawn once into a render texture at the pack's 64 px tile size and
   * scaled to `TILE_SIZE`: grass outdoors, wooden floors inside buildings, asphalt roads,
   * brick walls (windows sit in walls, doors on floor). Variants are picked per tile so the
   * ground is not a repeating stamp, deterministically so every client draws the same board.
   */
  private drawMap(state: GameState): void {
    const { map } = state;
    this.drawnMap = map;
    this.scene.scale.resize(map.width * TILE_SIZE, map.height * TILE_SIZE);
    this.tileLayer?.destroy();
    const rt = this.scene.add
      .renderTexture(0, 0, map.width * SOURCE_TILE, map.height * SOURCE_TILE)
      .setOrigin(0, 0)
      .setScale(FIGURE_SCALE)
      .setDepth(DEPTH.tiles);
    this.tileLayer = rt;
    const outdoors = outdoorGrid(map);
    const roadBeside = (x: number, y: number): boolean =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => map.tiles[y + (dy ?? 0)]?.[x + (dx ?? 0)]?.type === "road");
    const keyFor = (type: TileType, x: number, y: number): string => {
      switch (type) {
        case "road":
          return variant(TILE_KEYS.asphalt, x, y);
        case "wall":
        case "window":
          return variant(TILE_KEYS.brick, x, y);
        case "floor":
        case "door":
          // Open ground beside a road is pavement; the rest of a lot is grass.
          if (outdoors[y]?.[x] !== true) return variant(TILE_KEYS.wood, x, y);
          return roadBeside(x, y)
            ? variant(TILE_KEYS.concrete, x, y)
            : variant(TILE_KEYS.grass, x, y);
      }
    };
    map.tiles.forEach((row, y) => {
      row.forEach((tile, x) => {
        rt.drawFrame(keyFor(tile.type, x, y), undefined, x * SOURCE_TILE, y * SOURCE_TILE);
      });
    });
    const zone = this.zoneLayer;
    zone.clear();
    for (const p of objectiveZoneTiles(state.objective)) {
      const { x: px, y: py } = tileToPixel(p);
      zone.fillStyle(COLOURS.extraction, 0.55);
      zone.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      zone.lineStyle(2, COLOURS.healFlash, 0.8);
      zone.strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
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
      // A looted container stays on the board, faded, so the room still reads as furnished.
      sprite.body.setAlpha(container.searched ? 0.45 : 1);
    }
    for (const [id, sprite] of this.containers) {
      if (!seen.has(id)) {
        sprite.container.destroy();
        this.containers.delete(id);
      }
    }
  }

  private createContainerSprite(container: SearchableContainer): ContainerSprite {
    const body = this.scene.add
      .image(0, 0, CONTAINER_KEYS[container.category])
      .setScale(FIGURE_SCALE * 0.9);
    const group = this.scene.add.container(0, 0, [body]).setDepth(DEPTH.furniture);
    const sprite: ContainerSprite = { container: group, body };
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
   * A door fills its opening when closed or locked (with a lock mark), stands as a leaf
   * along one edge when open, and lies as a splintered plank when broken; a window is a
   * pane of glass across the opening, shards when broken.
   */
  private createBarrierSprite(barrier: Barrier): Phaser.GameObjects.Container {
    const parts: Phaser.GameObjects.GameObject[] = [];
    const image = (key: string, x = 0, y = 0) =>
      this.scene.add.image(x, y, key).setScale(FIGURE_SCALE);
    if (barrier.kind === "door") {
      switch (barrier.state) {
        case "closed":
          parts.push(image(FURNITURE_KEYS.doorClosed));
          break;
        case "locked":
          parts.push(
            image(FURNITURE_KEYS.doorClosed),
            this.scene.add.rectangle(0, 0, TILE_SIZE * 0.22, TILE_SIZE * 0.22, COLOURS.doorLock),
          );
          break;
        case "open":
          parts.push(image(FURNITURE_KEYS.doorOpen, -TILE_SIZE * 0.32, 0));
          break;
        case "broken":
          parts.push(image(FURNITURE_KEYS.doorBroken).setAlpha(0.85));
          break;
      }
    } else {
      parts.push(
        barrier.state === "broken"
          ? image(FURNITURE_KEYS.windowBroken)
          : image(FURNITURE_KEYS.window),
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
    // Item icons come in two sizes (64 px tiles and larger generic icons); fit both to
    // roughly half a tile so a pistol and a medkit read at the same weight.
    const body = this.scene.add.image(0, 0, ITEM_KEYS[type]);
    const longest = Math.max(body.width, body.height, 1);
    body.setScale((TILE_SIZE * 0.55) / longest);
    const container = this.scene.add.container(0, 0, [body]).setDepth(DEPTH.items);
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
      const before = this.shownState?.players.find((p) => p.id === player.id)?.position;
      sprite.facing = facingAfter(sprite.facing, before, player.position);
      const pose = player.status === "down" ? "stand" : WEAPON_POSE[player.weapon.type];
      sprite.body
        .setTexture(characterKey(SPECIALTY_CHARACTER[player.specialty], pose))
        .setRotation(player.status === "down" ? sprite.facing + Math.PI / 2 : sprite.facing)
        .setTint(player.status === "down" ? COLOURS.down : sprite.tint)
        .setAlpha(player.present ? 1 : 0.4);
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
    // The turn ring keeps each player's colour so teammates stay telling apart at a glance;
    // a thin badge in that colour sits under the figure at all times.
    const badge = this.scene.add.circle(0, 0, TILE_SIZE * 0.36, colour, 0.35);
    const ring = this.scene.add
      .circle(0, 0, TILE_SIZE * 0.44)
      .setStrokeStyle(3, COLOURS.activeRing);
    const body = this.scene.add
      .image(0, 0, characterKey(SPECIALTY_CHARACTER[player.specialty], "stand"))
      .setScale(FIGURE_SCALE);
    const label = this.scene.add
      .text(0, -TILE_SIZE * 0.46, player.name.slice(0, 8), {
        fontSize: "10px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    const [healthBack, healthFill] = createHealthBar(this.scene);
    const container = this.scene.add
      .container(0, 0, [badge, ring, body, label, healthBack, healthFill])
      .setDepth(DEPTH.entities);
    const sprite: EntitySprite = {
      container,
      body,
      ring,
      tint: 0xffffff,
      healthFill,
      facing: FACING_RIGHT,
    };
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
      const before = this.shownState?.zombies.find((z) => z.id === zombie.id)?.position;
      sprite.facing = facingAfter(sprite.facing, before, zombie.position);
      sprite.body.setRotation(sprite.facing).setTint(sprite.tint);
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
    const look = ZOMBIE_LOOK[zombie.type];
    const body = this.scene.add
      .image(0, 0, characterKey(ZOMBIE_CHARACTER[zombie.type], "hold"))
      .setScale(FIGURE_SCALE * look.scale)
      .setTint(look.tint);
    const [healthBack, healthFill] = createHealthBar(this.scene);
    const container = this.scene.add
      .container(0, 0, [body, healthBack, healthFill])
      .setDepth(DEPTH.entities);
    const sprite: EntitySprite = {
      container,
      body,
      tint: look.tint,
      healthFill,
      // Zombies start facing a random-looking but deterministic way, from their position.
      facing: (variant([0, 1, 2, 3], zombie.position.x, zombie.position.y) * Math.PI) / 2,
    };
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

/** The direction of the last step, or the previous facing when the figure did not move. */
function facingAfter(current: number, before: Position | undefined, after: Position): number {
  if (before === undefined || (before.x === after.x && before.y === after.y)) return current;
  return Math.atan2(after.y - before.y, after.x - before.x);
}

function setHealthBar(sprite: EntitySprite, fraction: number): void {
  sprite.healthFill.setDisplaySize(Math.max(0, Math.min(1, fraction)) * HEALTH_BAR_WIDTH, 4);
}
