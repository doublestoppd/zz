/** Integer tile coordinates. (0, 0) is the top-left tile; x grows right, y grows down. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Static tile kinds. Adding a kind means extending this union and the row in
 * `TILE_DEFINITIONS` below; TypeScript reports every place that must handle it.
 */
export type TileType = "floor" | "road" | "door" | "window" | "wall";

/**
 * Describes the terrain only. Players and zombies are separate entities that reference
 * positions, and so are the barriers standing in `door` and `window` tiles: those tiles are
 * openings in a wall, and whether one can be walked or seen through right now is decided by
 * the `Barrier` entity on it (`rules/barriers.ts`), not by these static flags.
 */
export interface Tile {
  readonly type: TileType;
  readonly walkable: boolean;
  readonly blocksVision: boolean;
}

export interface GameMap {
  readonly width: number;
  readonly height: number;
  /** Row-major: `tiles[y][x]`. Every row has exactly `width` entries. */
  readonly tiles: readonly (readonly Tile[])[];
}

/** Canonical tile properties per type. Map builders should use these rather than hand-writing tiles. */
export const TILE_DEFINITIONS: Readonly<Record<TileType, Tile>> = {
  floor: { type: "floor", walkable: true, blocksVision: false },
  road: { type: "road", walkable: true, blocksVision: false },
  door: { type: "door", walkable: true, blocksVision: false },
  window: { type: "window", walkable: true, blocksVision: false },
  wall: { type: "wall", walkable: false, blocksVision: true },
};
