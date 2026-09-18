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
      zombieDefinitions: {
        walker: { maxHealth: 3, damage: 2, movesPerPhase: 1, sightRange: 6 },
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
      itemDefinitions: {
        bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
        medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
        ammo_box: {
          effect: { kind: "ammo", ammoType: "pistol_rounds", rounds: 6 },
          useActionPointCost: 1,
        },
        shell_box: {
          effect: { kind: "ammo", ammoType: "shells", rounds: 4 },
          useActionPointCost: 1,
        },
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
          kind: "firearm",
          damage: 2,
          range: 4,
          attackActionPointCost: 1,
          noise: 8,
          ammoType: "pistol_rounds",
          magazineSize: 6,
          reloadActionPointCost: 1,
        },
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
        bat: {
          kind: "melee",
          damage: 2,
          range: 1,
          attackActionPointCost: 2,
          noise: 1,
          knockback: true,
        },
      },
    },
    survivor: {
      maxHealth: 10,
      maxActionPoints: 2,
      startingWeapon: "pistol",
      startingMeleeWeapon: "knife",
      startingReserveAmmo: { pistol_rounds: 6, shells: 0, rifle_rounds: 0 },
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
