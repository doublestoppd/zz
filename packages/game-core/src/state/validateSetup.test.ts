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
      searchActionPointCost: 2,
      searchNoise: 2,
      noiseDurationRounds: 2,
      openDoorActionPointCost: 1,
      closeDoorActionPointCost: 1,
      forceEntryActionPointCost: 2,
      forceEntryNoise: 6,
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
      zombieDefinitions: { walker: { maxHealth: 3, damage: 2, movesPerPhase: 1, sightRange: 6 } },
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
      itemDefinitions: {
        bandage: { effect: { kind: "heal", amount: 3 }, useActionPointCost: 1 },
        medkit: { effect: { kind: "heal", amount: 5 }, useActionPointCost: 1 },
        ammo_box: { effect: { kind: "ammo", rounds: 6 }, useActionPointCost: 1 },
        key: { effect: { kind: "key" }, useActionPointCost: 0 },
      },
    },
    survivor: {
      maxHealth: 10,
      maxActionPoints: 4,
      startingWeapon: "pistol",
      startingReserveAmmo: 12,
      inventoryCapacity: 3,
    },
    objective: { kind: "extraction", holdoutRounds: 1 },
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

  it("rejects opening tiles without a barrier, misplaced barriers, and open windows", () => {
    const base = setup({ layout: parseAsciiMap(["######", "#SL+E#", "#S.ZW#", "######"]) });
    expect(validateMatchSetup(base)).toEqual([]);
    const bare = { ...base.layout, barriers: [] };
    expect(validateMatchSetup(setup({ layout: bare }))).toEqual([
      "door tile (3, 1) has no barrier",
      "window tile (4, 2) has no barrier",
    ]);
    const wrong = {
      ...base.layout,
      barriers: [
        { position: { x: 1, y: 1 }, kind: "door", state: "closed" },
        { position: { x: 3, y: 1 }, kind: "door", state: "closed" },
        { position: { x: 4, y: 2 }, kind: "window", state: "open" },
      ] as const,
    };
    expect(validateMatchSetup(setup({ layout: wrong }))).toEqual([
      "door at (1, 1) is not on a door tile",
      "window at (4, 2) cannot be open",
    ]);
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
