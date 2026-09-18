import { positionKey, searchFrom, tileAt, type MapLayout, type Position } from "@zombie/game-core";

export interface LayoutExpectations {
  readonly survivorSpawns: number;
  readonly zombieSpawns: number;
  readonly lootSpawns: number;
  readonly objectiveSpawns: number;
}

export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable problems; empty when ok. */
  readonly issues: readonly string[];
}

/**
 * Checks everything the game relies on: counts, walkability, distinctness, that every
 * door and window tile carries a barrier, and that every marker is reachable from every
 * survivor spawn. Entities are ignored for reachability because the board is empty at this
 * point, and barriers are ignored too: any door or window can be opened or forced.
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
  if (layout.lootSpawns.length !== expected.lootSpawns) {
    issues.push(`expected ${expected.lootSpawns} loot spawns, got ${layout.lootSpawns.length}`);
  }
  if (layout.extractionZone.length === 0) issues.push("extraction zone is empty");
  if (layout.objectiveSpawns.length !== expected.objectiveSpawns) {
    issues.push(
      `expected ${expected.objectiveSpawns} objective spawns, got ${layout.objectiveSpawns.length}`,
    );
  }

  const walkable = (p: Position): boolean => tileAt(map, p)?.walkable ?? false;
  const groups: [string, readonly Position[]][] = [
    ["survivor spawn", layout.spawnPositions],
    ["extraction tile", layout.extractionZone],
    ["zombie spawn", layout.zombieSpawns],
    ["loot spawn", layout.lootSpawns],
    ["container", layout.containers.map((c) => c.position)],
    ["barrier", layout.barriers.map((b) => b.position)],
    ["objective spawn", layout.objectiveSpawns],
  ];
  for (const p of layout.safehouse) {
    if (!walkable(p)) issues.push(`safehouse tile at (${p.x}, ${p.y}) is not walkable`);
  }
  const seen = new Set<string>();
  for (const [label, positions] of groups) {
    for (const p of positions) {
      if (!walkable(p)) issues.push(`${label} at (${p.x}, ${p.y}) is not walkable`);
      const key = positionKey(p);
      if (seen.has(key)) issues.push(`${label} at (${p.x}, ${p.y}) overlaps another marker`);
      seen.add(key);
    }
  }
  const barrierKeys = new Set(layout.barriers.map((b) => positionKey(b.position)));
  for (const b of layout.barriers) {
    const type = tileAt(map, b.position)?.type;
    if (type !== b.kind)
      issues.push(
        `${b.kind} at (${b.position.x}, ${b.position.y}) is on a ${type ?? "missing"} tile`,
      );
  }
  map.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if (
        (tile.type === "door" || tile.type === "window") &&
        !barrierKeys.has(positionKey({ x, y }))
      ) {
        issues.push(`${tile.type} tile (${x}, ${y}) has no barrier`);
      }
    });
  });
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
    for (const p of layout.lootSpawns) {
      if (reach.distanceTo(p) === undefined) {
        issues.push(`loot spawn (${p.x}, ${p.y}) unreachable from spawn (${spawn.x}, ${spawn.y})`);
      }
    }
    for (const p of [...layout.objectiveSpawns, ...layout.safehouse]) {
      if (reach.distanceTo(p) === undefined) {
        issues.push(
          `scenario tile (${p.x}, ${p.y}) unreachable from spawn (${spawn.x}, ${spawn.y})`,
        );
      }
    }
    for (const c of layout.containers) {
      if (reach.distanceTo(c.position) === undefined) {
        issues.push(
          `container (${c.position.x}, ${c.position.y}) unreachable from spawn (${spawn.x}, ${spawn.y})`,
        );
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
