import {
  TILE_DEFINITIONS,
  type GameMap,
  type Position,
  type Tile,
  type TileType,
} from "@zombie/game-core";

/** Mutable working grid used only while generating. Converted to an immutable GameMap at the end. */
export class Grid {
  private readonly cells: TileType[][];

  constructor(
    readonly width: number,
    readonly height: number,
    fill: TileType,
  ) {
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
  }

  inBounds(p: Position): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  get(p: Position): TileType | undefined {
    return this.cells[p.y]?.[p.x];
  }

  set(p: Position, type: TileType): void {
    const row = this.cells[p.y];
    if (row !== undefined && p.x >= 0 && p.x < this.width) row[p.x] = type;
  }

  fillRect(x: number, y: number, w: number, h: number, type: TileType): void {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) this.set({ x: xx, y: yy }, type);
    }
  }

  toGameMap(): GameMap {
    const tiles: Tile[][] = this.cells.map((row) => row.map((type) => TILE_DEFINITIONS[type]));
    return { width: this.width, height: this.height, tiles };
  }
}
