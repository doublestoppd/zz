import {
  createRng,
  deriveSeed,
  positionKey,
  RNG_STREAM,
  searchFrom,
  tileAt,
  type BarrierSpawn,
  type ContainerSpawn,
  type GameMap,
  type MapLayout,
  type Position,
  type Rng,
} from "@zombie/game-core";
import { Grid } from "./grid.js";
import {
  BUILDING_TEMPLATES,
  rotateStamp,
  templateToStamp,
  type BuildingTemplate,
  type Stamp,
} from "./templates/buildings.js";
import { validateLayout } from "./validate/validateLayout.js";

export interface CityOptions {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly survivorSpawns: number;
  readonly zombieSpawns: number;
  readonly lootSpawns: number;
}

export const DEFAULT_CITY_OPTIONS: Omit<CityOptions, "seed"> = {
  width: 26,
  height: 18,
  survivorSpawns: 4,
  zombieSpawns: 5,
  lootSpawns: 3,
};

/** Generation knobs that are not per-match. Change the city's feel here. */
const ROAD_WIDTH = 2;
const MIN_BLOCK = 5;
const MAX_BLOCK = 8;
/** Blocks are split into lots of at most this size in each dimension; each lot may hold one building. */
const LOT_SIZE = 7;
/** Chance (0..1) that a lot gets a building rather than staying open ground. */
const BUILDING_CHANCE = 0.8;
/** Zombies spawn at least this fraction of the longest path away from the survivors. */
const ZOMBIE_MIN_DISTANCE_FRACTION = 0.35;
const MAX_ATTEMPTS = 12;

/**
 * Generates a city deterministically from `seed`. Composition, not noise:
 *   1. a grid of roads splits the map into blocks;
 *   2. most blocks receive one authored building template, rotated at random;
 *   3. survivors spawn together on the western road;
 *   4. the extraction zone is a 2x2 walkable area far from the spawn;
 *   5. zombies spawn on reachable tiles well away from the survivors;
 *   6. every building's `c` cells become searchable containers of the template's category,
 *      its doors and windows become barriers, and a few loose items land on reachable
 *      open ground; zombies and the extraction zone stay outdoors (reachable without
 *      passing any door or window) so nothing important starts sealed in a building;
 *   7. the layout is validated; on failure the next attempt uses a derived seed.
 * Throws only if every attempt fails, which indicates a generator bug, not bad luck.
 */
export function generateCity(options: CityOptions): MapLayout {
  const baseSeed = deriveSeed(options.seed, RNG_STREAM.mapGeneration);
  const failures: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const rng = createRng(deriveSeed(baseSeed, attempt));
    const layout = buildCity(rng, options);
    if (layout === undefined) {
      failures.push(`attempt ${attempt}: could not place markers`);
      continue;
    }
    const result = validateLayout(layout, {
      survivorSpawns: options.survivorSpawns,
      zombieSpawns: options.zombieSpawns,
      lootSpawns: options.lootSpawns,
    });
    if (result.ok) return layout;
    failures.push(`attempt ${attempt}: ${result.issues.join("; ")}`);
  }
  throw new Error(`generateCity: no valid layout for seed ${options.seed}\n${failures.join("\n")}`);
}

interface Block {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function buildCity(rng: Rng, options: CityOptions): MapLayout | undefined {
  const grid = new Grid(options.width, options.height, "floor");
  // Outer wall ring keeps every path inside the map.
  grid.fillRect(0, 0, options.width, 1, "wall");
  grid.fillRect(0, options.height - 1, options.width, 1, "wall");
  grid.fillRect(0, 0, 1, options.height, "wall");
  grid.fillRect(options.width - 1, 0, 1, options.height, "wall");

  const roadXs = roadPositions(rng, options.width);
  const roadYs = roadPositions(rng, options.height);
  for (const x of roadXs) grid.fillRect(x, 1, ROAD_WIDTH, options.height - 2, "road");
  for (const y of roadYs) grid.fillRect(1, y, options.width - 2, ROAD_WIDTH, "road");

  const containers: ContainerSpawn[] = [];
  const barriers: BarrierSpawn[] = [];
  for (const block of blocksBetween(roadXs, roadYs, options)) {
    for (const lot of splitIntoLots(block)) {
      if (rng.next() < BUILDING_CHANCE) {
        const placed = placeBuilding(grid, rng, lot);
        containers.push(...placed.containers);
        barriers.push(...placed.barriers);
      }
    }
  }

  const spawnPositions = placeSurvivorSpawns(grid, rng, roadXs, options.survivorSpawns);
  if (spawnPositions === undefined) return undefined;
  const map = grid.toGameMap();
  const anchor = spawnPositions[0];
  if (anchor === undefined) return undefined;
  const unlimited = options.width * options.height;
  const reach = searchFrom(map, anchor, unlimited, () => true);
  const outdoors = searchFrom(map, anchor, unlimited, (p) => !isOpening(map, p));

  const extractionZone = placeExtraction(grid, outdoors, spawnPositions);
  if (extractionZone === undefined) return undefined;
  const taken = new Set(
    [
      ...spawnPositions,
      ...extractionZone,
      ...containers.map((c) => c.position),
      ...barriers.map((b) => b.position),
    ].map(positionKey),
  );
  const zombieSpawns = placeZombies(grid, rng, outdoors, taken, options.zombieSpawns);
  if (zombieSpawns === undefined) return undefined;
  for (const p of zombieSpawns) taken.add(positionKey(p));
  const lootSpawns = placeLoot(grid, rng, reach, taken, options.lootSpawns);
  if (lootSpawns === undefined) return undefined;

  return { map, spawnPositions, extractionZone, zombieSpawns, lootSpawns, containers, barriers };
}

/** A door or window tile: passable in principle, but a barrier stands in it. */
function isOpening(map: GameMap, p: Position): boolean {
  const type = tileAt(map, p)?.type;
  return type === "door" || type === "window";
}

/**
 * Left/top coordinates of each road, starting just inside the border. A trailing road that
 * would leave a sliver narrower than MIN_BLOCK before the far wall is dropped so the last
 * block can hold a building.
 */
function roadPositions(rng: Rng, extent: number): number[] {
  const positions: number[] = [];
  let cursor = 1;
  while (cursor + ROAD_WIDTH <= extent - 1) {
    positions.push(cursor);
    cursor += ROAD_WIDTH + rng.int(MIN_BLOCK, MAX_BLOCK);
  }
  const last = positions.at(-1);
  if (positions.length > 1 && last !== undefined && extent - 1 - (last + ROAD_WIDTH) < MIN_BLOCK) {
    positions.pop();
  }
  return positions;
}

/** The rectangles of ground between consecutive roads (and between the last road and the border). */
function blocksBetween(roadXs: number[], roadYs: number[], options: CityOptions): Block[] {
  const spans = (roads: number[], extent: number): [number, number][] => {
    const result: [number, number][] = [];
    for (let i = 0; i < roads.length; i += 1) {
      const start = (roads[i] ?? 0) + ROAD_WIDTH;
      const end = i + 1 < roads.length ? (roads[i + 1] ?? extent) : extent - 1;
      if (end - start >= 3) result.push([start, end - start]);
    }
    return result;
  };
  const blocks: Block[] = [];
  for (const [y, h] of spans(roadYs, options.height)) {
    for (const [x, w] of spans(roadXs, options.width)) blocks.push({ x, y, w, h });
  }
  return blocks;
}

/** Cuts a block into roughly equal lots no larger than LOT_SIZE in either dimension. */
function splitIntoLots(block: Block): Block[] {
  const cut = (start: number, length: number): [number, number][] => {
    const parts = Math.max(1, Math.ceil(length / LOT_SIZE));
    const base = Math.floor(length / parts);
    const result: [number, number][] = [];
    let cursor = start;
    for (let i = 0; i < parts; i += 1) {
      const size = i === parts - 1 ? start + length - cursor : base;
      result.push([cursor, size]);
      cursor += size;
    }
    return result;
  };
  const lots: Block[] = [];
  for (const [y, h] of cut(block.y, block.h)) {
    for (const [x, w] of cut(block.x, block.w)) lots.push({ x, y, w, h });
  }
  return lots;
}

/**
 * Stamps one random template that fits inside the lot, if any. A lot's left and top edges
 * touch a road or the open strip of the neighbouring lot, so doors there open onto walkable
 * ground; the right and bottom edges keep a one-tile strip free so neighbouring buildings
 * never seal each other's doors and nothing faces the outer wall.
 */
interface PlacedBuilding {
  readonly containers: ContainerSpawn[];
  readonly barriers: BarrierSpawn[];
}

function placeBuilding(grid: Grid, rng: Rng, block: Block): PlacedBuilding {
  const usableW = block.w - 1;
  const usableH = block.h - 1;
  const candidates: { stamp: Stamp; template: BuildingTemplate }[] = [];
  for (const template of BUILDING_TEMPLATES) {
    const base = templateToStamp(template.rows);
    for (let turn = 0; turn < 4; turn += 1) {
      const stamp = rotateStamp(base, turn);
      if (stamp.width <= usableW && stamp.height <= usableH) candidates.push({ stamp, template });
    }
  }
  const chosen = candidates.length === 0 ? undefined : rng.pick(candidates);
  if (chosen === undefined) return { containers: [], barriers: [] };
  const { stamp, template } = chosen;
  const x = block.x + rng.int(0, usableW - stamp.width);
  const y = block.y + rng.int(0, usableH - stamp.height);
  const containers: ContainerSpawn[] = [];
  const barriers: BarrierSpawn[] = [];
  stamp.cells.forEach((row, dy) => {
    row.forEach((type, dx) => {
      const position = { x: x + dx, y: y + dy };
      if (type !== undefined) grid.set(position, type);
      if (stamp.containers[dy]?.[dx] === true) {
        containers.push({ position, category: template.category });
      }
      if (type === "door") {
        const locked = stamp.locked[dy]?.[dx] === true;
        barriers.push({ position, kind: "door", state: locked ? "locked" : "closed" });
      } else if (type === "window") {
        barriers.push({ position, kind: "window", state: "closed" });
      }
    });
  });
  return { containers, barriers };
}

/** A vertical run of tiles on the westernmost road, at a random height. */
function placeSurvivorSpawns(
  grid: Grid,
  rng: Rng,
  roadXs: number[],
  count: number,
): Position[] | undefined {
  const roadX = roadXs[0];
  if (roadX === undefined) return undefined;
  const perColumn = Math.ceil(count / ROAD_WIDTH);
  const maxY = grid.height - 1 - perColumn;
  if (maxY < 1) return undefined;
  const startY = rng.int(1, maxY);
  const positions: Position[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = { x: roadX + (i % ROAD_WIDTH), y: startY + Math.floor(i / ROAD_WIDTH) };
    if (grid.get(p) !== "road") return undefined;
    positions.push(p);
  }
  return positions;
}

/** The reachable 2x2 walkable square whose nearest corner is farthest from the survivors. */
function placeExtraction(
  grid: Grid,
  reach: ReturnType<typeof searchFrom>,
  spawns: readonly Position[],
): Position[] | undefined {
  const spawnKeys = new Set(spawns.map(positionKey));
  let best: { score: number; tiles: Position[] } | undefined;
  for (let y = 1; y < grid.height - 2; y += 1) {
    for (let x = 1; x < grid.width - 2; x += 1) {
      const tiles = [
        { x, y },
        { x: x + 1, y },
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
      ];
      if (tiles.some((p) => spawnKeys.has(positionKey(p)))) continue;
      const distances = tiles.map((p) => reach.distanceTo(p));
      if (distances.some((d) => d === undefined)) continue;
      const score = Math.min(...(distances as number[]));
      if (best === undefined || score > best.score) best = { score, tiles };
    }
  }
  return best?.tiles;
}

/** Distinct reachable tiles at least a fraction of the longest path away from the survivors. */
function placeZombies(
  grid: Grid,
  rng: Rng,
  reach: ReturnType<typeof searchFrom>,
  taken: ReadonlySet<string>,
  count: number,
): Position[] | undefined {
  const candidates: { p: Position; d: number }[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      const p = { x, y };
      const d = reach.distanceTo(p);
      if (d !== undefined && !taken.has(positionKey(p))) candidates.push({ p, d });
    }
  }
  const longest = Math.max(0, ...candidates.map((c) => c.d));
  const farEnough = candidates.filter((c) => c.d >= longest * ZOMBIE_MIN_DISTANCE_FRACTION);
  if (farEnough.length < count) return undefined;
  const chosen: Position[] = [];
  const pool = [...farEnough];
  for (let i = 0; i < count; i += 1) {
    const pick = rng.pick(pool);
    chosen.push(pick.p);
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen;
}

/**
 * Distinct reachable `floor` tiles (never roads), so loot sits in buildings and lots rather
 * than in the street. Interiors are preferred: a floor tile with at least three wall
 * neighbours counts as inside.
 */
function placeLoot(
  grid: Grid,
  rng: Rng,
  reach: ReturnType<typeof searchFrom>,
  taken: ReadonlySet<string>,
  count: number,
): Position[] | undefined {
  const inside: Position[] = [];
  const outside: Position[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      const p = { x, y };
      if (grid.get(p) !== "floor" || taken.has(positionKey(p))) continue;
      if (reach.distanceTo(p) === undefined) continue;
      const walls = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ].filter((n) => grid.get(n) === "wall").length;
      (walls >= 2 ? inside : outside).push(p);
    }
  }
  const chosen: Position[] = [];
  for (const pool of [inside, outside]) {
    while (chosen.length < count && pool.length > 0) {
      const pick = rng.pick(pool);
      chosen.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
  }
  return chosen.length === count ? chosen : undefined;
}
