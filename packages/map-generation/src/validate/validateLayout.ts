import { positionKey, searchFrom, tileAt, type MapLayout, type Position } from "@zombie/game-core";

export interface LayoutExpectations {
  readonly survivorSpawns: number;
  readonly zombieSpawns: number;
}

export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable problems; empty when ok. */
  readonly issues: readonly string[];
}

/**
 * Checks everything the game relies on: counts, walkability, distinctness, and that every
 * extraction tile and zombie spawn is reachable from every survivor spawn. Entities are
 * ignored for reachability because the board is empty at this point.
 */
export function validateLayout(layout: MapLayout, expected: LayoutExpectations): ValidationResult {
  const issues: string[] = [];
  const { map } = layout;

  if (map.height !== map.tiles.length || map.tiles.some((row) => row.length !== map.width)) {
    issues.push("map dimensions do not match the tile grid");
  }
  if (layout.spawnPositions.length !== expected.survivorSpawns) {
    issues.push(
      `expected ${expected.survivorSpawns} survivor spawns, got ${layout.spawnPositions.length}`,
    );
  }
  if (layout.zombieSpawns.length !== expected.zombieSpawns) {
    issues.push(
      `expected ${expected.zombieSpawns} zombie spawns, got ${layout.zombieSpawns.length}`,
    );
  }
  if (layout.extractionZone.length === 0) issues.push("extraction zone is empty");

  const walkable = (p: Position): boolean => tileAt(map, p)?.walkable ?? false;
  const groups: [string, readonly Position[]][] = [
    ["survivor spawn", layout.spawnPositions],
    ["extraction tile", layout.extractionZone],
    ["zombie spawn", layout.zombieSpawns],
  ];
  const seen = new Set<string>();
  for (const [label, positions] of groups) {
    for (const p of positions) {
      if (!walkable(p)) issues.push(`${label} at (${p.x}, ${p.y}) is not walkable`);
      const key = positionKey(p);
      if (seen.has(key)) issues.push(`${label} at (${p.x}, ${p.y}) overlaps another marker`);
      seen.add(key);
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const unlimited = map.width * map.height;
  for (const spawn of layout.spawnPositions) {
    const reach = searchFrom(map, spawn, unlimited, () => true);
    for (const p of layout.extractionZone) {
      if (reach.distanceTo(p) === undefined) {
        issues.push(
          `extraction tile (${p.x}, ${p.y}) unreachable from spawn (${spawn.x}, ${spawn.y})`,
        );
      }
    }
    for (const p of layout.zombieSpawns) {
      if (reach.distanceTo(p) === undefined) {
        issues.push(
          `zombie spawn (${p.x}, ${p.y}) unreachable from spawn (${spawn.x}, ${spawn.y})`,
        );
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
