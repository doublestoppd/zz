import type { TileType } from "@zombie/game-core";

/**
 * Authored building footprints. Legend: `#` wall, `.` interior floor, `+` door.
 * Every template has at least one door on its bottom edge; rotation supplies the others.
 * Add a template here to enrich the city; the placer picks any that fits the block.
 */
export const BUILDING_TEMPLATES: readonly (readonly string[])[] = [
  // Kiosk
  ["###", "#.#", "#+#"],
  // Small hut
  ["####", "#..#", "#..#", "#+##"],
  // House
  ["#####", "#...#", "#...#", "#...#", "##+##"],
  // Shop with two doors
  ["#######", "#.....#", "#.....#", "#+###+#"],
  // Long hall
  ["########", "#......#", "#......#", "###+####"],
  // L-shaped block (the notch stays open ground)
  ["######", "#....#", "#....#", "#..###", "#+.#.."],
];

const LEGEND: Readonly<Record<string, TileType>> = { "#": "wall", ".": "floor", "+": "door" };

export interface Stamp {
  readonly width: number;
  readonly height: number;
  /** Row-major cells; undefined means "leave the ground as it is" (used by notches). */
  readonly cells: readonly (readonly (TileType | undefined)[])[];
}

export function templateToStamp(rows: readonly string[]): Stamp {
  const width = rows[0]?.length ?? 0;
  const cells = rows.map((row) =>
    Array.from({ length: width }, (_, x) => {
      const symbol = row[x] ?? " ";
      return LEGEND[symbol];
    }),
  );
  return { width, height: rows.length, cells };
}

/** Rotates a stamp clockwise by 90 degrees `quarterTurns` times. */
export function rotateStamp(stamp: Stamp, quarterTurns: number): Stamp {
  let current = stamp;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i += 1) {
    const cells = Array.from({ length: current.width }, (_, y) =>
      Array.from({ length: current.height }, (_, x) => current.cells[current.height - 1 - x]?.[y]),
    );
    current = { width: current.height, height: current.width, cells };
  }
  return current;
}
