import { isInBounds, positionKey, tileAt } from "../map/position.js";
import type { GameMap, Position } from "../map/types.js";
import type { BarrierSpawn } from "../map/asciiMap.js";
import type { MatchSetup } from "./createInitialState.js";
import type { SpecialtyModifiers, WeaponDefinition } from "./definitions.js";
import { AMMO_TYPES } from "./types.js";

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
  for (const player of players) {
    const specialty = player.specialty ?? "survivor";
    if (!(specialty in rules.specialtyDefinitions)) {
      issues.push(`player ${player.id} specialty "${specialty}" has no definition`);
    }
  }
  for (const [type, specialty] of Object.entries(rules.specialtyDefinitions)) {
    for (const name of Object.keys(specialty.modifiers) as (keyof SpecialtyModifiers)[]) {
      positiveInteger(issues, `specialty ${type}.${name}`, specialty.modifiers[name], 0);
    }
  }

  checkPositions(issues, map, "survivor spawn", layout.spawnPositions.slice(0, players.length));
  checkPositions(issues, map, "zombie spawn", layout.zombieSpawns);
  checkPositions(issues, map, "loot spawn", layout.lootSpawns);
  checkPositions(issues, map, "extraction tile", layout.extractionZone);
  checkPositions(
    issues,
    map,
    "container",
    layout.containers.map((c) => c.position),
  );
  checkBarriers(issues, map, layout.barriers);
  const occupied = [...layout.spawnPositions.slice(0, players.length), ...layout.zombieSpawns];
  if (new Set(occupied.map(positionKey)).size !== occupied.length) {
    issues.push("survivor and zombie spawns overlap");
  }

  positiveInteger(issues, "rules.moveCostPerTile", rules.moveCostPerTile, 1);
  positiveInteger(issues, "rules.pickUpActionPointCost", rules.pickUpActionPointCost, 0);
  positiveInteger(issues, "rules.searchActionPointCost", rules.searchActionPointCost, 0);
  positiveInteger(issues, "rules.searchNoise", rules.searchNoise, 0);
  positiveInteger(issues, "rules.noiseDurationRounds", rules.noiseDurationRounds, 1);
  positiveInteger(issues, "rules.openDoorActionPointCost", rules.openDoorActionPointCost, 0);
  positiveInteger(issues, "rules.closeDoorActionPointCost", rules.closeDoorActionPointCost, 0);
  positiveInteger(issues, "rules.forceEntryActionPointCost", rules.forceEntryActionPointCost, 0);
  positiveInteger(issues, "rules.forceEntryNoise", rules.forceEntryNoise, 0);
  for (const [category, table] of Object.entries(rules.searchLootTables)) {
    positiveInteger(issues, `search table ${category}.minRolls`, table.minRolls, 0);
    positiveInteger(issues, `search table ${category}.maxRolls`, table.maxRolls, table.minRolls);
    if (table.entries.length === 0) issues.push(`search table ${category} has no entries`);
    for (const entry of table.entries) {
      positiveInteger(issues, `search table ${category} weight for ${entry.type}`, entry.weight, 1);
      if (entry.type !== "nothing" && !(entry.type in rules.itemDefinitions)) {
        issues.push(`search table ${category} item "${entry.type}" has no definition`);
      }
    }
  }
  for (const [type, weapon] of Object.entries(rules.weaponDefinitions)) {
    positiveInteger(issues, `weapon ${type}.damage`, weapon.damage, 0);
    positiveInteger(issues, `weapon ${type}.range`, weapon.range, 1);
    positiveInteger(
      issues,
      `weapon ${type}.attackActionPointCost`,
      weapon.attackActionPointCost,
      0,
    );
    positiveInteger(issues, `weapon ${type}.noise`, weapon.noise, 0);
    if (weapon.kind === "firearm") {
      positiveInteger(issues, `weapon ${type}.magazineSize`, weapon.magazineSize, 1);
      positiveInteger(
        issues,
        `weapon ${type}.reloadActionPointCost`,
        weapon.reloadActionPointCost,
        0,
      );
      if (!AMMO_TYPES.includes(weapon.ammoType)) {
        issues.push(`weapon ${type}.ammoType "${weapon.ammoType}" is unknown`);
      }
      for (const [i, damage] of (weapon.damageByDistance ?? []).entries()) {
        positiveInteger(issues, `weapon ${type}.damageByDistance[${i}]`, damage, 0);
      }
    }
  }
  for (const [type, zombie] of Object.entries(rules.zombieDefinitions)) {
    positiveInteger(issues, `zombie ${type}.maxHealth`, zombie.maxHealth, 1);
    positiveInteger(issues, `zombie ${type}.damage`, zombie.damage, 0);
    positiveInteger(issues, `zombie ${type}.movesPerPhase`, zombie.movesPerPhase, 1);
    positiveInteger(issues, `zombie ${type}.sightRange`, zombie.sightRange, 1);
  }
  for (const [type, item] of Object.entries(rules.itemDefinitions)) {
    positiveInteger(issues, `item ${type}.useActionPointCost`, item.useActionPointCost, 0);
    const amount =
      item.effect.kind === "heal"
        ? item.effect.amount
        : item.effect.kind === "ammo"
          ? item.effect.rounds
          : undefined;
    if (amount !== undefined) positiveInteger(issues, `item ${type} effect amount`, amount, 1);
    if (item.effect.kind === "weapon" && !(item.effect.weaponType in rules.weaponDefinitions)) {
      issues.push(`item ${type} equips "${item.effect.weaponType}", which has no definition`);
    }
  }
  positiveInteger(issues, "survivor.maxHealth", survivor.maxHealth, 1);
  positiveInteger(issues, "survivor.maxActionPoints", survivor.maxActionPoints, 1);
  for (const ammoType of AMMO_TYPES) {
    positiveInteger(
      issues,
      `survivor.startingReserveAmmo.${ammoType}`,
      survivor.startingReserveAmmo[ammoType],
      0,
    );
  }
  positiveInteger(issues, "survivor.inventoryCapacity", survivor.inventoryCapacity, 0);
  const firearm = (rules.weaponDefinitions as Partial<Record<string, WeaponDefinition>>)[
    survivor.startingWeapon
  ];
  if (firearm === undefined) {
    issues.push(`survivor.startingWeapon "${survivor.startingWeapon}" has no definition`);
  } else if (firearm.kind !== "firearm") {
    issues.push(`survivor.startingWeapon "${survivor.startingWeapon}" is not a firearm`);
  }
  const melee = (rules.weaponDefinitions as Partial<Record<string, WeaponDefinition>>)[
    survivor.startingMeleeWeapon
  ];
  if (melee === undefined) {
    issues.push(`survivor.startingMeleeWeapon "${survivor.startingMeleeWeapon}" has no definition`);
  } else if (melee.kind !== "melee") {
    issues.push(
      `survivor.startingMeleeWeapon "${survivor.startingMeleeWeapon}" is not a melee weapon`,
    );
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

/**
 * Every door/window tile carries exactly one barrier of the matching kind, and a window is
 * only ever intact or broken. Otherwise an opening would be passable by accident.
 */
function checkBarriers(issues: string[], map: GameMap, barriers: readonly BarrierSpawn[]): void {
  const seen = new Set<string>();
  for (const b of barriers) {
    const tile = tileAt(map, b.position);
    const expected = b.kind === "door" ? "door" : "window";
    if (tile?.type !== expected) {
      issues.push(`${b.kind} at (${b.position.x}, ${b.position.y}) is not on a ${expected} tile`);
    }
    if (b.kind === "window" && b.state !== "closed" && b.state !== "broken") {
      issues.push(`window at (${b.position.x}, ${b.position.y}) cannot be ${b.state}`);
    }
    const key = positionKey(b.position);
    if (seen.has(key)) issues.push(`two barriers at (${b.position.x}, ${b.position.y})`);
    seen.add(key);
  }
  map.tiles.forEach((row, y) => {
    row.forEach((tile, x) => {
      if ((tile.type === "door" || tile.type === "window") && !seen.has(positionKey({ x, y }))) {
        issues.push(`${tile.type} tile (${x}, ${y}) has no barrier`);
      }
    });
  });
}

function positiveInteger(issues: string[], name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    issues.push(`${name} must be an integer >= ${min}, got ${String(value)}`);
  }
}
