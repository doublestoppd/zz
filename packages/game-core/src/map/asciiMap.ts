import { TILE_DEFINITIONS, type GameMap, type Position, type Tile } from "./types.js";

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
}

/**
 * Legend for hand-authored maps:
 *   `#` wall   `.` floor   `S` floor + survivor spawn   `E` floor + extraction zone
 */
export function parseAsciiMap(rows: readonly string[]): MapLayout {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    throw new Error("parseAsciiMap: map must have at least one row and one column");
  }

  const spawnPositions: Position[] = [];
  const extractionZone: Position[] = [];
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
        case "S":
          tileRow.push(TILE_DEFINITIONS.floor);
          spawnPositions.push({ x, y });
          break;
        case "E":
          tileRow.push(TILE_DEFINITIONS.floor);
          extractionZone.push({ x, y });
          break;
        default:
          throw new Error(`parseAsciiMap: unknown symbol '${symbol}' at (${x}, ${y})`);
      }
    }
    tiles.push(tileRow);
  });

  return { map: { width, height, tiles }, spawnPositions, extractionZone };
}
