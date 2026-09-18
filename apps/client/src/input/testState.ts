import {
  createInitialState,
  matchId,
  parseAsciiMap,
  playerId,
  type GameState,
} from "@zombie/game-core";

export const P1 = playerId("p1");
export const P2 = playerId("p2");

/** P1 at (1,1), P2 at (1,2), one zombie at (3,2) in an open room. Test-only. */
export function makeClientTestState(
  rows: readonly string[] = ["#####", "#S..#", "#S.Z#", "#####"],
): GameState {
  return createInitialState({
    matchId: matchId("m"),
    seed: 1,
    rules: {
      moveCostPerTile: 1,
      zombieDefinitions: { walker: { maxHealth: 3, damage: 2, movesPerPhase: 1, sightRange: 6 } },
      itemDefinitions: {
        bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
        medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
        ammo_box: { effect: { kind: "ammo", rounds: 6 }, useActionPointCost: 1 },
        key: { effect: { kind: "key" }, useActionPointCost: 0 },
      },
      pickUpActionPointCost: 1,
      searchActionPointCost: 2,
      searchNoise: 2,
      noiseDurationRounds: 2,
      openDoorActionPointCost: 1,
      closeDoorActionPointCost: 1,
      forceEntryActionPointCost: 2,
      forceEntryNoise: 6,
      searchLootTables: {
        home: { minRolls: 1, maxRolls: 1, entries: [{ type: "bandage", weight: 1 }] },
        clinic: { minRolls: 1, maxRolls: 1, entries: [{ type: "medkit", weight: 1 }] },
        police: { minRolls: 1, maxRolls: 1, entries: [{ type: "ammo_box", weight: 1 }] },
        shop: { minRolls: 0, maxRolls: 1, entries: [{ type: "nothing", weight: 1 }] },
      },
      weaponDefinitions: {
        pistol: {
          damage: 2,
          range: 4,
          magazineSize: 6,
          fireActionPointCost: 1,
          reloadActionPointCost: 1,
          noise: 8,
        },
      },
    },
    survivor: {
      maxHealth: 10,
      maxActionPoints: 2,
      startingWeapon: "pistol",
      startingReserveAmmo: 6,
      inventoryCapacity: 3,
    },
    lootTable: [{ type: "medkit", weight: 1 }],
    zombieSpawnTable: [{ type: "walker", weight: 1 }],
    objective: { kind: "extraction", holdoutRounds: 0 },
    layout: parseAsciiMap(rows),
    players: [
      { id: P1, name: "one" },
      { id: P2, name: "two" },
    ],
  });
}
