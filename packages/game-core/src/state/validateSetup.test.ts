import { describe, expect, it } from "vitest";
import { matchId, playerId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createInitialState, type MatchSetup } from "./createInitialState.js";
import { validateMatchSetup } from "./validateSetup.js";

const P1 = playerId("p1");
const P2 = playerId("p2");

function setup(overrides: Partial<MatchSetup> = {}): MatchSetup {
  return {
    matchId: matchId("m"),
    seed: 1,
    rules: {
      moveCostPerTile: 1,
      pickUpActionPointCost: 1,
      zombieDefinitions: { walker: { maxHealth: 3, damage: 2, movesPerPhase: 1 } },
      weaponDefinitions: {
        pistol: {
          damage: 2,
          range: 4,
          magazineSize: 6,
          fireActionPointCost: 1,
          reloadActionPointCost: 1,
        },
      },
      itemDefinitions: {
        medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
        ammo_box: { effect: { kind: "ammo", rounds: 6 }, useActionPointCost: 1 },
      },
    },
    survivor: {
      maxHealth: 10,
      maxActionPoints: 4,
      startingWeapon: "pistol",
      startingReserveAmmo: 12,
      inventoryCapacity: 3,
    },
    extraction: { holdoutRounds: 1 },
    lootTable: [{ type: "medkit", weight: 1 }],
    zombieSpawnTable: [{ type: "walker", weight: 1 }],
    layout: parseAsciiMap(["######", "#SL.E#", "#S.Z.#", "######"]),
    players: [
      { id: P1, name: "a" },
      { id: P2, name: "b" },
    ],
    ...overrides,
  };
}

describe("validateMatchSetup", () => {
  it("accepts a well-formed setup", () => {
    expect(validateMatchSetup(setup())).toEqual([]);
    expect(() => createInitialState(setup())).not.toThrow();
  });

  it("rejects non-positive rule numbers that would break rules", () => {
    const bad = setup({ rules: { ...setup().rules, moveCostPerTile: 0 } });
    expect(validateMatchSetup(bad)).toEqual([
      "rules.moveCostPerTile must be an integer >= 1, got 0",
    ]);
    expect(() => createInitialState(bad)).toThrow(/moveCostPerTile/);
  });

  it("rejects spawns that are out of bounds, in walls, duplicated, or overlapping", () => {
    const base = setup();
    const badLayout = {
      ...base.layout,
      spawnPositions: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      zombieSpawns: [{ x: 9, y: 9 }],
    };
    const issues = validateMatchSetup(setup({ layout: badLayout }));
    expect(issues).toEqual(
      expect.arrayContaining([
        "survivor spawn (0, 0) is not walkable",
        "survivor spawn (0, 0) is listed twice",
        "zombie spawn (9, 9) is outside the map",
        "survivor and zombie spawns overlap",
      ]),
    );
  });

  it("rejects too many or duplicate players and an empty loot table with loot spawns", () => {
    expect(
      validateMatchSetup(
        setup({
          players: [
            { id: P1, name: "a" },
            { id: P1, name: "b" },
          ],
        }),
      ),
    ).toContain("duplicate player ids");
    expect(
      validateMatchSetup(
        setup({ players: [1, 2, 3].map((n) => ({ id: playerId(`p${n}`), name: "x" })) }),
      ),
    ).toContain("3 players but only 2 spawn positions");
    expect(validateMatchSetup(setup({ lootTable: [] }))).toContain(
      "loot spawns exist but the loot table is empty",
    );
  });

  it("rejects a starting weapon or loot item without a definition", () => {
    const noWeapon = setup({
      survivor: { ...setup().survivor, startingWeapon: "rifle" as "pistol" },
    });
    expect(validateMatchSetup(noWeapon)).toContain(
      'survivor.startingWeapon "rifle" has no definition',
    );
  });
});
