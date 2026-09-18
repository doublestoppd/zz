import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { itemId, zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState, WeaponType } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { damageAtDistance, legalMeleeTargets, validateFire, validateMelee } from "./combat.js";

/** P1 at (1,1); z1 adjacent at (2,1), z2 two tiles off at (3,1), z3 far at (8,1). */
const ROW = parseAsciiMap(["##########", "#SZZ....Z#", "#........#", "##########"]);
const Z1 = zombieId("z1");
const Z2 = zombieId("z2");
const Z3 = zombieId("z3");

function armed(state: GameState, firearm: WeaponType, loaded = 2): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === P1
        ? {
            ...p,
            weapon: { type: firearm, loadedAmmo: loaded },
            reserveAmmo: { pistol_rounds: 3, shells: 4, rifle_rounds: 5 },
          }
        : p,
    ),
  };
}

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("firearms differ in more than damage", () => {
  const base = makeTestState({ players: [P1], layout: ROW, zombieHealth: 9 });

  it("a shotgun hits hard next door, weakly at two tiles, and not at all beyond", () => {
    const state = armed(base, "shotgun");
    const p = findPlayer(state, P1)!;
    expect(validateFire(state, p, Z1)).toMatchObject({ ok: true, damage: 5 });
    expect(validateFire(state, p, Z2)).toMatchObject({ ok: true, damage: 3 });
    expect(validateFire(state, p, Z3)).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
    const shot = must(applyCommand(state, { type: "fire_weapon", playerId: P1, targetId: Z1 }));
    expect(shot.state.zombies[0]?.health).toBe(4);
    expect(shot.events).toContainEqual({
      type: "noise_made",
      noiseId: "n1",
      position: { x: 1, y: 1 },
      intensity: 12,
      sourceType: "gunfire",
    });
  });

  it("falls back to base damage past the falloff table", () => {
    const shotgun = base.rules.weaponDefinitions.shotgun;
    if (shotgun.kind !== "firearm") throw new Error("shotgun is a firearm");
    expect(damageAtDistance(shotgun, 1)).toBe(5);
    expect(damageAtDistance(shotgun, 2)).toBe(3);
    expect(damageAtDistance(shotgun, 3)).toBe(1);
  });

  it("a rifle reaches seven tiles but a shot costs two action points", () => {
    const state = armed(base, "rifle");
    const p = findPlayer(state, P1)!;
    expect(validateFire(state, p, Z3)).toMatchObject({ ok: true, damage: 4 });
    const shot = must(applyCommand(state, { type: "fire_weapon", playerId: P1, targetId: Z3 }));
    expect(findPlayer(shot.state, P1)?.actionPoints).toBe(2);
    const twice = applyCommand(shot.state, { type: "fire_weapon", playerId: P1, targetId: Z3 });
    expect(twice.ok).toBe(true);
    const thrice = applyCommand(must(twice).state, {
      type: "fire_weapon",
      playerId: P1,
      targetId: Z3,
    });
    expect(thrice).toEqual({ ok: false, reason: "WEAPON_EMPTY" });
  });

  it("reloads from the reserve of its own ammunition kind only", () => {
    const state = armed(base, "rifle", 0);
    const reloaded = must(applyCommand(state, { type: "reload", playerId: P1 }));
    expect(findPlayer(reloaded.state, P1)).toMatchObject({
      weapon: { type: "rifle", loadedAmmo: 5 },
      reserveAmmo: { pistol_rounds: 3, shells: 4, rifle_rounds: 0 },
    });
    expect(reloaded.events[0]).toMatchObject({ type: "weapon_reloaded", ammoType: "rifle_rounds" });
    const dry = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        reserveAmmo: { ...p.reserveAmmo, rifle_rounds: 0 },
      })),
    };
    expect(applyCommand(dry, { type: "reload", playerId: P1 })).toEqual({
      ok: false,
      reason: "NO_RESERVE_AMMO",
    });
  });

  it("ammunition items feed only their own kind", () => {
    const state = {
      ...base,
      players: base.players.map((p) => ({ ...p, inventory: ["shell_box" as const] })),
    };
    const used = must(
      applyCommand(state, { type: "use_item", playerId: P1, itemType: "shell_box" }),
    );
    expect(findPlayer(used.state, P1)?.reserveAmmo).toEqual({
      pistol_rounds: 12,
      shells: 4,
      rifle_rounds: 0,
    });
    expect(used.events[1]).toMatchObject({ type: "ammo_gained", ammoType: "shells", rounds: 4 });
  });
});

describe("melee", () => {
  const base = makeTestState({ players: [P1], layout: ROW, zombieHealth: 3 });

  it("strikes only an adjacent zombie, for action points and no ammunition", () => {
    const p = findPlayer(base, P1)!;
    expect(validateMelee(base, p, Z1)).toMatchObject({ ok: true, knockbackTo: undefined });
    expect(validateMelee(base, p, Z2)).toEqual({ ok: false, reason: "NOT_ADJACENT" });
    expect(validateMelee(base, p, zombieId("nope"))).toEqual({
      ok: false,
      reason: "TARGET_NOT_FOUND",
    });
    expect(legalMeleeTargets(base, p).map((z) => z.id)).toEqual([Z1]);
    const empty = {
      ...base,
      players: base.players.map((q) => ({
        ...q,
        weapon: { ...q.weapon, loadedAmmo: 0 },
        reserveAmmo: { pistol_rounds: 0, shells: 0, rifle_rounds: 0 },
      })),
    };
    const hit = must(applyCommand(empty, { type: "melee_attack", playerId: P1, targetId: Z1 }));
    expect(hit.events).toEqual([
      {
        type: "weapon_swung",
        playerId: P1,
        weaponType: "knife",
        targetId: Z1,
        actionPointsSpent: 1,
      },
      { type: "entity_damaged", entityId: Z1, damage: 1, remainingHealth: 2 },
    ]);
    // A knife is silent: no noise event and nothing for zombies to hear.
    expect(hit.state.noises).toEqual([]);
    expect(findPlayer(hit.state, P1)?.actionPoints).toBe(3);
    const tired = {
      ...base,
      players: base.players.map((q) => ({ ...q, actionPoints: 0 })),
    };
    expect(applyCommand(tired, { type: "melee_attack", playerId: P1, targetId: Z1 })).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });

  it("a bat costs more, is barely audible, and shoves the target back when the tile is free", () => {
    // z1 at (2,1) is backed by z2 at (3,1): no room. Use an open row instead.
    const open = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["#######", "#SZ...#", "#.....#", "#######"]),
      zombieHealth: 5,
      startingMeleeWeapon: "bat",
    });
    const hit = must(applyCommand(open, { type: "melee_attack", playerId: P1, targetId: Z1 }));
    expect(hit.state.zombies[0]).toMatchObject({ position: { x: 3, y: 1 }, health: 3 });
    expect(hit.events).toEqual([
      { type: "weapon_swung", playerId: P1, weaponType: "bat", targetId: Z1, actionPointsSpent: 2 },
      { type: "entity_damaged", entityId: Z1, damage: 2, remainingHealth: 3 },
      { type: "zombie_knocked_back", zombieId: Z1, from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      {
        type: "noise_made",
        noiseId: "n1",
        position: { x: 1, y: 1 },
        intensity: 1,
        sourceType: "melee",
      },
    ]);
    expect(findPlayer(hit.state, P1)?.actionPoints).toBe(2);
  });

  it("knockback needs a free, passable tile behind the target and never moves a corpse", () => {
    const blocked = makeTestState({
      players: [P1],
      layout: ROW,
      zombieHealth: 5,
      startingMeleeWeapon: "bat",
    });
    const hit = must(applyCommand(blocked, { type: "melee_attack", playerId: P1, targetId: Z1 }));
    expect(hit.state.zombies[0]?.position).toEqual({ x: 2, y: 1 });
    expect(hit.events.some((e) => e.type === "zombie_knocked_back")).toBe(false);
    const wall = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["#####", "#SZ##", "#####"]),
      zombieHealth: 5,
      startingMeleeWeapon: "bat",
    });
    expect(validateMelee(wall, findPlayer(wall, P1)!, Z1)).toMatchObject({
      ok: true,
      knockbackTo: undefined,
    });
    const lethal = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["#######", "#SZ...#", "#######"]),
      zombieHealth: 2,
      startingMeleeWeapon: "bat",
    });
    const kill = must(applyCommand(lethal, { type: "melee_attack", playerId: P1, targetId: Z1 }));
    expect(kill.state.zombies).toEqual([]);
    expect(kill.events.map((e) => e.type)).toEqual([
      "weapon_swung",
      "entity_damaged",
      "entity_died",
      "noise_made",
    ]);
  });
});

describe("picking up weapons", () => {
  /** P1 at (1,1) standing on a loot spawn; the loot table rolls a shotgun. */
  const layout = parseAsciiMap(["#####", "#S..#", "#####"]);
  const base = {
    ...makeTestState({ players: [P1], layout }),
    items: [{ id: itemId("i1"), type: "shotgun" as const, position: { x: 1, y: 1 } }],
  };

  it("swaps the firearm, unloads the old one into the reserve, and drops it underfoot", () => {
    const took = must(applyCommand(base, { type: "pick_up", playerId: P1, itemId: itemId("i1") }));
    expect(findPlayer(took.state, P1)).toMatchObject({
      weapon: { type: "shotgun", loadedAmmo: 0 },
      meleeWeapon: "knife",
      reserveAmmo: { pistol_rounds: 18, shells: 0, rifle_rounds: 0 },
      inventory: [],
      actionPoints: 3,
    });
    expect(took.state.items).toEqual([{ id: "i1-x", type: "pistol", position: { x: 1, y: 1 } }]);
    expect(took.events).toEqual([
      {
        type: "item_picked_up",
        playerId: P1,
        itemId: "i1",
        itemType: "shotgun",
        actionPointsSpent: 1,
      },
      {
        type: "weapon_equipped",
        playerId: P1,
        weaponType: "shotgun",
        replaced: "pistol",
        droppedItemId: "i1-x",
      },
    ]);
    // Swapping back restores the pistol, empty, and leaves the shotgun on the floor.
    const back = must(
      applyCommand(took.state, { type: "pick_up", playerId: P1, itemId: itemId("i1-x") }),
    );
    expect(findPlayer(back.state, P1)?.weapon).toEqual({ type: "pistol", loadedAmmo: 0 });
    expect(back.state.items.map((i) => i.type)).toEqual(["shotgun"]);
  });

  it("a melee weapon replaces the melee slot and ignores inventory space", () => {
    const full = {
      ...base,
      items: [{ id: itemId("i1"), type: "bat" as const, position: { x: 1, y: 1 } }],
      players: base.players.map((p) => ({
        ...p,
        inventory: ["bandage" as const, "bandage" as const, "bandage" as const],
      })),
    };
    const took = must(applyCommand(full, { type: "pick_up", playerId: P1, itemId: itemId("i1") }));
    expect(findPlayer(took.state, P1)).toMatchObject({
      meleeWeapon: "bat",
      weapon: { type: "pistol", loadedAmmo: 6 },
    });
    expect(took.state.items[0]?.type).toBe("knife");
  });

  it("weapons cannot be used from the inventory", () => {
    const state = {
      ...base,
      players: base.players.map((p) => ({ ...p, inventory: ["bat" as const] })),
    };
    expect(applyCommand(state, { type: "use_item", playerId: P1, itemType: "bat" })).toEqual({
      ok: false,
      reason: "ITEM_NOT_USABLE",
    });
  });
});
