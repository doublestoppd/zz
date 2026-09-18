import type { BarrierKind, BarrierState, ContainerCategory } from "../state/types.js";
import { TILE_DEFINITIONS, type GameMap, type Position, type Tile } from "./types.js";

/** Where a searchable container stands and what kind of place it is in. */
export interface ContainerSpawn {
  readonly position: Position;
  readonly category: ContainerCategory;
}

/** A door or window in an opening tile, with the state it starts the match in. */
export interface BarrierSpawn {
  readonly position: Position;
  readonly kind: BarrierKind;
  readonly state: BarrierState;
}

/**
 * A map plus the marker positions a scenario needs. Produced by `parseAsciiMap`;
 * the same shape will later be produced by the procedural generator.
 */
export interface MapLayout {
  readonly map: GameMap;
  /** Survivor spawn tiles, in the order players are assigned to them. */
  readonly spawnPositions: readonly Position[];
  /** Tiles that form the extraction zone. Not evaluated until the objective milestone. */
  readonly extractionZone: readonly Position[];
  /** Where zombies start, in id order. */
  readonly zombieSpawns: readonly Position[];
  /** Where ground items are placed; the item type is rolled at match creation. */
  readonly lootSpawns: readonly Position[];
  /** Searchable containers, in id order. */
  readonly containers: readonly ContainerSpawn[];
  /** Doors and windows, in id order. Every `door` and `window` tile has exactly one. */
  readonly barriers: readonly BarrierSpawn[];
}

/**
 * Legend for hand-authored maps:
 *   `#` wall   `.` floor   `=` road   `S` floor + survivor spawn
 *   `E` floor + extraction zone   `Z` floor + zombie spawn   `L` floor + loot spawn
 *   `C` floor + searchable container (category "home")
 *   `+` closed door   `O` open door   `K` locked door   `W` window (intact)
 */
export function parseAsciiMap(rows: readonly string[]): MapLayout {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    throw new Error("parseAsciiMap: map must have at least one row and one column");
  }

  const spawnPositions: Position[] = [];
  const extractionZone: Position[] = [];
  const zombieSpawns: Position[] = [];
  const lootSpawns: Position[] = [];
  const containers: ContainerSpawn[] = [];
  const barriers: BarrierSpawn[] = [];
  const tiles: Tile[][] = [];

  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`parseAsciiMap: row ${y} has length ${row.length}, expected ${width}`);
    }
    const tileRow: Tile[] = [];
    for (let x = 0; x < width; x += 1) {
      const symbol = row[x] ?? "";
      switch (symbol) {
        case "#":
          tileRow.push(TILE_DEFINITIONS.wall);
          break;
        case ".":
          tileRow.push(TILE_DEFINITIONS.floor);
          break;
        case "=":
          tileRow.push(TILE_DEFINITIONS.road);
          break;
        case "+":
          tileRow.push(TILE_DEFINITIONS.door);
          barriers.push({ position: { x, y }, kind: "door", state: "closed" });
          break;
        case "O":
          tileRow.push(TILE_DEFINITIONS.door);
          barriers.push({ position: { x, y }, kind: "door", state: "open" });
          break;
        case "K":
          tileRow.push(TILE_DEFINITIONS.door);
          barriers.push({ position: { x, y }, kind: "door", state: "locked" });
          break;
        case "W":
          tileRow.push(TILE_DEFINITIONS.window);
          barriers.push({ position: { x, y }, kind: "window", state: "closed" });
          break;
        case "S":
          tileRow.push(TILE_DEFINITIONS.floor);
          spawnPositions.push({ x, y });
          break;
        case "E":
          tileRow.push(TILE_DEFINITIONS.floor);
          extractionZone.push({ x, y });
          break;
        case "Z":
          tileRow.push(TILE_DEFINITIONS.floor);
          zombieSpawns.push({ x, y });
          break;
        case "L":
          tileRow.push(TILE_DEFINITIONS.floor);
          lootSpawns.push({ x, y });
          break;
        case "C":
          tileRow.push(TILE_DEFINITIONS.floor);
          containers.push({ position: { x, y }, category: "home" });
          break;
        default:
          throw new Error(`parseAsciiMap: unknown symbol '${symbol}' at (${x}, ${y})`);
      }
    }
    tiles.push(tileRow);
  });

  return {
    map: { width, height, tiles },
    spawnPositions,
    extractionZone,
    zombieSpawns,
    lootSpawns,
    containers,
    barriers,
  };
}
