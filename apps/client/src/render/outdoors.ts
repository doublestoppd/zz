import type { GameMap } from "@zombie/game-core";

/**
 * Which walkable tiles are outside a building: everything reachable from a road or from
 * the map's edge without passing a wall, door, or window. Roads are always open air and
 * generated cities are ringed by a wall, so both seeds are needed. Buildings are closed
 * shells, so their floors stay unmarked and get an interior look. Pure; only the map decides.
 */
export function outdoorGrid(map: GameMap): boolean[][] {
  const outdoors: boolean[][] = map.tiles.map((row) => row.map(() => false));
  const blocks = (x: number, y: number): boolean => {
    const type = map.tiles[y]?.[x]?.type;
    return type === undefined || type === "wall" || type === "door" || type === "window";
  };
  const queue: [number, number][] = [];
  const push = (x: number, y: number) => {
    const row = outdoors[y];
    if (row === undefined || x < 0 || x >= map.width) return;
    if (row[x] === true || blocks(x, y)) return;
    row[x] = true;
    queue.push([x, y]);
  };
  for (let x = 0; x < map.width; x += 1) {
    push(x, 0);
    push(x, map.height - 1);
  }
  for (let y = 0; y < map.height; y += 1) {
    push(0, y);
    push(map.width - 1, y);
  }
  map.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (tile.type === "road") push(x, y);
    });
  });
  // Entries appended during iteration are visited too: array iteration is live.
  for (const [x, y] of queue) {
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return outdoors;
}
