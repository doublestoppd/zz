import { isInBounds, positionKey, tileAt } from "../map/position.js";
import type { GameMap, Position } from "../map/types.js";
import type { MatchSetup } from "./createInitialState.js";

/**
 * Every invariant `createInitialState` relies on, checked up front so a bad layout or a
 * mis-typed balance number fails loudly at match creation instead of producing a match that
 * breaks a rule silently (free movement, two survivors on one wall tile, and so on).
 * Returns human-readable problems; empty means valid.
 */
export function validateMatchSetup(setup: MatchSetup): string[] {
  const issues: string[] = [];
  const { layout, rules, survivor, players } = setup;
  const { map } = layout;

  if (map.tiles.length !== map.height || map.tiles.some((row) => row.length !== map.width)) {
    issues.push("map dimensions do not match the tile grid");
  }

  if (players.length === 0) issues.push("a match needs at least one player");
  if (players.length > layout.spawnPositions.length) {
    issues.push(
      `${players.length} players but only ${layout.spawnPositions.length} spawn positions`,
    );
  }
  if (new Set(players.map((p) => p.id)).size !== players.length)
    issues.push("duplicate player ids");

  checkPositions(issues, map, "survivor spawn", layout.spawnPositions.slice(0, players.length));
  checkPositions(issues, map, "zombie spawn", layout.zombieSpawns);
  checkPositions(issues, map, "loot spawn", layout.lootSpawns);
  checkPositions(issues, map, "extraction tile", layout.extractionZone);
  const occupied = [...layout.spawnPositions.slice(0, players.length), ...layout.zombieSpawns];
  if (new Set(occupied.map(positionKey)).size !== occupied.length) {
    issues.push("survivor and zombie spawns overlap");
  }

  positiveInteger(issues, "rules.moveCostPerTile", rules.moveCostPerTile, 1);
  positiveInteger(issues, "rules.pickUpActionPointCost", rules.pickUpActionPointCost, 0);
  for (const [type, weapon] of Object.entries(rules.weaponDefinitions)) {
    positiveInteger(issues, `weapon ${type}.damage`, weapon.damage, 0);
    positiveInteger(issues, `weapon ${type}.range`, weapon.range, 1);
    positiveInteger(issues, `weapon ${type}.magazineSize`, weapon.magazineSize, 1);
    positiveInteger(issues, `weapon ${type}.fireActionPointCost`, weapon.fireActionPointCost, 0);
    positiveInteger(
      issues,
      `weapon ${type}.reloadActionPointCost`,
      weapon.reloadActionPointCost,
      0,
    );
  }
  for (const [type, zombie] of Object.entries(rules.zombieDefinitions)) {
    positiveInteger(issues, `zombie ${type}.maxHealth`, zombie.maxHealth, 1);
    positiveInteger(issues, `zombie ${type}.damage`, zombie.damage, 0);
    positiveInteger(issues, `zombie ${type}.movesPerPhase`, zombie.movesPerPhase, 1);
  }
  for (const [type, item] of Object.entries(rules.itemDefinitions)) {
    positiveInteger(issues, `item ${type}.useActionPointCost`, item.useActionPointCost, 0);
    const amount = item.effect.kind === "heal" ? item.effect.amount : item.effect.rounds;
    positiveInteger(issues, `item ${type} effect amount`, amount, 1);
  }
  positiveInteger(issues, "survivor.maxHealth", survivor.maxHealth, 1);
  positiveInteger(issues, "survivor.maxActionPoints", survivor.maxActionPoints, 1);
  positiveInteger(issues, "survivor.startingReserveAmmo", survivor.startingReserveAmmo, 0);
  positiveInteger(issues, "survivor.inventoryCapacity", survivor.inventoryCapacity, 0);
  if (!(survivor.startingWeapon in rules.weaponDefinitions)) {
    issues.push(`survivor.startingWeapon "${survivor.startingWeapon}" has no definition`);
  }
  switch (setup.objective.kind) {
    case "extraction":
      positiveInteger(issues, "objective.holdoutRounds", setup.objective.holdoutRounds, 0);
      break;
  }

  if (layout.zombieSpawns.length > 0) {
    if (setup.zombieSpawnTable.length === 0)
      issues.push("zombie spawns exist but the spawn table is empty");
    for (const entry of setup.zombieSpawnTable) {
      positiveInteger(issues, `zombie spawn table weight for ${entry.type}`, entry.weight, 1);
      if (!(entry.type in rules.zombieDefinitions))
        issues.push(`zombie spawn table type "${entry.type}" has no definition`);
    }
  }
  if (layout.lootSpawns.length > 0) {
    if (setup.lootTable.length === 0) issues.push("loot spawns exist but the loot table is empty");
    for (const entry of setup.lootTable) {
      positiveInteger(issues, `loot table weight for ${entry.type}`, entry.weight, 1);
      if (!(entry.type in rules.itemDefinitions))
        issues.push(`loot table item "${entry.type}" has no definition`);
    }
  }
  return issues;
}

function checkPositions(
  issues: string[],
  map: GameMap,
  label: string,
  positions: readonly Position[],
): void {
  const seen = new Set<string>();
  for (const p of positions) {
    if (!isInBounds(map, p)) issues.push(`${label} (${p.x}, ${p.y}) is outside the map`);
    else if (!(tileAt(map, p)?.walkable ?? false))
      issues.push(`${label} (${p.x}, ${p.y}) is not walkable`);
    const key = positionKey(p);
    if (seen.has(key)) issues.push(`${label} (${p.x}, ${p.y}) is listed twice`);
    seen.add(key);
  }
}

function positiveInteger(issues: string[], name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    issues.push(`${name} must be an integer >= ${min}, got ${String(value)}`);
  }
}
