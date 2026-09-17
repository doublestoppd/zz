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
      zombieDefinitions: { walker: { maxHealth: 3, damage: 2, movesPerPhase: 1 } },
      itemDefinitions: {
        medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
        ammo_box: { effect: { kind: "ammo", rounds: 6 }, useActionPointCost: 1 },
      },
      pickUpActionPointCost: 1,
      weaponDefinitions: {
        pistol: {
          damage: 2,
          range: 4,
          magazineSize: 6,
          fireActionPointCost: 1,
          reloadActionPointCost: 1,
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
