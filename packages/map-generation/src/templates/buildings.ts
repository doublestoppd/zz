import type { ContainerCategory, TileType } from "@zombie/game-core";

/**
 * Authored building footprints. Legend: `#` wall, `.` interior floor, `+` door,
 * `c` interior floor with a searchable container. Every template has at least one door on
 * its bottom edge; rotation supplies the others. The category decides which loot table the
 * building's containers roll from. Add a template here to enrich the city; the placer picks
 * any that fits the lot.
 */
export interface BuildingTemplate {
  readonly category: ContainerCategory;
  readonly rows: readonly string[];
}

export const BUILDING_TEMPLATES: readonly BuildingTemplate[] = [
  // Kiosk
  { category: "shop", rows: ["###", "#c#", "#+#"] },
  // Small hut
  { category: "home", rows: ["####", "#c.#", "#..#", "#+##"] },
  // House
  { category: "home", rows: ["#####", "#c..#", "#...#", "#..c#", "##+##"] },
  // Clinic with two doors
  { category: "clinic", rows: ["#######", "#c...c#", "#.....#", "#+###+#"] },
  // Police station
  { category: "police", rows: ["########", "#c....c#", "#......#", "###+####"] },
  // L-shaped shop (the notch stays open ground)
  { category: "shop", rows: ["######", "#c...#", "#....#", "#..###", "#+.#.."] },
];

const LEGEND: Readonly<Record<string, TileType>> = {
  "#": "wall",
  ".": "floor",
  "+": "door",
  c: "floor",
};

export interface Stamp {
  readonly width: number;
  readonly height: number;
  /** Row-major cells; undefined means "leave the ground as it is" (used by notches). */
  readonly cells: readonly (readonly (TileType | undefined)[])[];
  /** Row-major flags marking cells that hold a searchable container. */
  readonly containers: readonly (readonly boolean[])[];
}

export function templateToStamp(rows: readonly string[]): Stamp {
  const width = rows[0]?.length ?? 0;
  const cells = rows.map((row) =>
    Array.from({ length: width }, (_, x) => {
      const symbol = row[x] ?? " ";
      return LEGEND[symbol];
    }),
  );
  const containers = rows.map((row) => Array.from({ length: width }, (_, x) => row[x] === "c"));
  return { width, height: rows.length, cells, containers };
}

/** Rotates a stamp clockwise by 90 degrees `quarterTurns` times. */
export function rotateStamp(stamp: Stamp, quarterTurns: number): Stamp {
  let current = stamp;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i += 1) {
    const rotate = <T>(grid: readonly (readonly T[])[], fallback: T): T[][] =>
      Array.from({ length: current.width }, (_, y) =>
        Array.from(
          { length: current.height },
          (_, x) => grid[current.height - 1 - x]?.[y] ?? fallback,
        ),
      );
    current = {
      width: current.height,
      height: current.width,
      cells: rotate<TileType | undefined>(current.cells, undefined),
      containers: rotate<boolean>(current.containers, false),
    };
  }
  return current;
}
