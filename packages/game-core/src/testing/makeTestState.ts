import { matchId, playerId, type PlayerId } from "../ids.js";
import { parseAsciiMap, type MapLayout } from "../map/asciiMap.js";
import { createInitialState } from "../state/createInitialState.js";
import type {
  FirearmDefinition,
  ItemDefinition,
  WeaponDefinition,
  ZombieSpawnTableEntry,
} from "../state/definitions.js";
import type { ItemType, WeaponType } from "../state/types.js";
import type { GameState } from "../state/types.js";

/**
 * Test-only builder. A 8x6 room with two pillars, four spawns down the left column,
 * and no zombies unless a layout with `Z` markers is supplied.
 *
 *   ########
 *   #S.....#
 *   #S.#...#
 *   #S.#...#
 *   #S.....#
 *   ########
 */
export const TEST_LAYOUT: MapLayout = parseAsciiMap([
  "########",
  "#S.....#",
  "#S.#...#",
  "#S.#...#",
  "#S.....#",
  "########",
]);

export const P1 = playerId("p1");
export const P2 = playerId("p2");
export const P3 = playerId("p3");

export interface TestStateOptions {
  readonly players?: readonly PlayerId[];
  readonly maxActionPoints?: number;
  readonly moveCostPerTile?: number;
  readonly layout?: MapLayout;
  readonly seed?: number;
  readonly zombieDamage?: number;
  readonly zombieHealth?: number;
  readonly pistol?: Partial<FirearmDefinition>;
  /** Overrides for any weapon definition, by type. */
  readonly weapons?: Partial<Record<WeaponType, Partial<WeaponDefinition>>>;
  readonly startingMeleeWeapon?: WeaponType;
  readonly startingReserveAmmo?: number;
  readonly holdoutRounds?: number;
  readonly inventoryCapacity?: number;
  readonly zombieMovesPerPhase?: number;
  readonly searchActionPointCost?: number;
  readonly searchNoise?: number;
  readonly zombieSightRange?: number;
  readonly forceEntryNoise?: number;
  /** Which types the `Z` markers roll; every marker is a walker by default. */
  readonly zombieSpawnTable?: readonly ZombieSpawnTableEntry[];
}

const DEFAULT_PISTOL: FirearmDefinition = {
  kind: "firearm",
  damage: 2,
  range: 4,
  attackActionPointCost: 1,
  noise: 8,
  ammoType: "pistol_rounds",
  magazineSize: 6,
  reloadActionPointCost: 1,
};

/** The full weapon set as tests see it; game-data holds the real numbers. */
export const TEST_WEAPONS: Readonly<Record<WeaponType, WeaponDefinition>> = {
  pistol: DEFAULT_PISTOL,
  shotgun: {
    kind: "firearm",
    damage: 1,
    damageByDistance: [5, 3],
    range: 2,
    attackActionPointCost: 1,
    noise: 12,
    ammoType: "shells",
    magazineSize: 2,
    reloadActionPointCost: 1,
  },
  rifle: {
    kind: "firearm",
    damage: 4,
    range: 7,
    attackActionPointCost: 2,
    noise: 10,
    ammoType: "rifle_rounds",
    magazineSize: 5,
    reloadActionPointCost: 1,
  },
  knife: { kind: "melee", damage: 1, range: 1, attackActionPointCost: 1, noise: 0 },
  bat: { kind: "melee", damage: 2, range: 1, attackActionPointCost: 2, noise: 1, knockback: true },
};

export const TEST_ITEMS: Readonly<Record<ItemType, ItemDefinition>> = {
  bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
  medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
  ammo_box: {
    effect: { kind: "ammo", ammoType: "pistol_rounds", rounds: 6 },
    useActionPointCost: 1,
  },
  shell_box: { effect: { kind: "ammo", ammoType: "shells", rounds: 4 }, useActionPointCost: 1 },
  rifle_clip: {
    effect: { kind: "ammo", ammoType: "rifle_rounds", rounds: 5 },
    useActionPointCost: 1,
  },
  key: { effect: { kind: "key" }, useActionPointCost: 0 },
  pistol: { effect: { kind: "weapon", weaponType: "pistol" }, useActionPointCost: 0 },
  shotgun: { effect: { kind: "weapon", weaponType: "shotgun" }, useActionPointCost: 0 },
  rifle: { effect: { kind: "weapon", weaponType: "rifle" }, useActionPointCost: 0 },
  knife: { effect: { kind: "weapon", weaponType: "knife" }, useActionPointCost: 0 },
  bat: { effect: { kind: "weapon", weaponType: "bat" }, useActionPointCost: 0 },
};

function mergeWeapons(
  base: Readonly<Record<WeaponType, WeaponDefinition>>,
  overrides: Partial<Record<WeaponType, Partial<WeaponDefinition>>>,
): Readonly<Record<WeaponType, WeaponDefinition>> {
  const merged = { ...base };
  for (const [type, patch] of Object.entries(overrides) as [
    WeaponType,
    Partial<WeaponDefinition>,
  ][]) {
    merged[type] = { ...merged[type], ...patch } as WeaponDefinition;
  }
  return merged;
}

export function makeTestState(options: TestStateOptions = {}): GameState {
  const players = options.players ?? [P1, P2];
  return createInitialState({
    matchId: matchId("test-match"),
    seed: options.seed ?? 42,
    rules: {
      moveCostPerTile: options.moveCostPerTile ?? 1,
      zombieDefinitions: {
        walker: {
          maxHealth: options.zombieHealth ?? 3,
          damage: options.zombieDamage ?? 2,
          movesPerPhase: options.zombieMovesPerPhase ?? 1,
          sightRange: options.zombieSightRange ?? 6,
        },
        runner: { maxHealth: 2, damage: 1, movesPerPhase: 2, sightRange: 8 },
        brute: {
          maxHealth: 8,
          damage: 4,
          movesPerPhase: 1,
          sightRange: 5,
          slow: true,
          unshakable: true,
        },
      },
      weaponDefinitions: mergeWeapons(
        { ...TEST_WEAPONS, pistol: { ...DEFAULT_PISTOL, ...options.pistol } },
        options.weapons ?? {},
      ),
      itemDefinitions: TEST_ITEMS,
      pickUpActionPointCost: 1,
      searchActionPointCost: options.searchActionPointCost ?? 2,
      searchNoise: options.searchNoise ?? 2,
      noiseDurationRounds: 2,
      openDoorActionPointCost: 1,
      closeDoorActionPointCost: 1,
      forceEntryActionPointCost: 2,
      forceEntryNoise: options.forceEntryNoise ?? 6,
      searchLootTables: {
        home: {
          minRolls: 1,
          maxRolls: 2,
          entries: [
            { type: "bandage", weight: 2 },
            { type: "ammo_box", weight: 1 },
            { type: "nothing", weight: 1 },
          ],
        },
        clinic: {
          minRolls: 1,
          maxRolls: 2,
          entries: [
            { type: "medkit", weight: 3 },
            { type: "bandage", weight: 2 },
          ],
        },
        police: {
          minRolls: 1,
          maxRolls: 2,
          entries: [
            { type: "ammo_box", weight: 4 },
            { type: "nothing", weight: 1 },
          ],
        },
        shop: {
          minRolls: 0,
          maxRolls: 2,
          entries: [
            { type: "bandage", weight: 1 },
            { type: "nothing", weight: 2 },
          ],
        },
      },
    },
    survivor: {
      maxHealth: 10,
      maxActionPoints: options.maxActionPoints ?? 4,
      startingWeapon: "pistol",
      startingMeleeWeapon: options.startingMeleeWeapon ?? "knife",
      startingReserveAmmo: {
        pistol_rounds: options.startingReserveAmmo ?? 12,
        shells: 0,
        rifle_rounds: 0,
      },
      inventoryCapacity: options.inventoryCapacity ?? 3,
    },
    lootTable: [{ type: "medkit", weight: 1 }],
    zombieSpawnTable: options.zombieSpawnTable ?? [{ type: "walker", weight: 1 }],
    objective: { kind: "extraction", holdoutRounds: options.holdoutRounds ?? 0 },
    layout: options.layout ?? TEST_LAYOUT,
    players: players.map((id) => ({ id, name: id })),
  });
}
