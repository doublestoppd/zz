import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { itemId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { itemsUnderPlayer, removeFromInventory, validatePickUp, validateUseItem } from "./items.js";

/** P1 at (1,1) with a loot spawn on the tile to the right and one further away. */
const LOOT = parseAsciiMap(["######", "#SL.L#", "#S...#", "######"]);
const I1 = itemId("i1");
const I2 = itemId("i2");

function withP1(state: GameState, patch: Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === P1 ? { ...p, ...patch } : p)) };
}

describe("loot at match creation", () => {
  it("places one item per loot spawn, rolled deterministically from the seed", () => {
    const a = makeTestState({ players: [P1], layout: LOOT, seed: 5 });
    const b = makeTestState({ players: [P1], layout: LOOT, seed: 5 });
    expect(a.items).toHaveLength(2);
    expect(a.items).toEqual(b.items);
    expect(a.items[0]).toEqual({ id: I1, type: "medkit", position: { x: 2, y: 1 } });
  });
});

describe("validatePickUp", () => {
  const onItem = withP1(makeTestState({ players: [P1], layout: LOOT }), {
    position: { x: 2, y: 1 },
  });
  const p1 = () => findPlayer(onItem, P1)!;

  it("accepts an item on the player's tile and lists what is underfoot", () => {
    expect(validatePickUp(onItem, p1(), I1)).toMatchObject({ ok: true, cost: 1, item: { id: I1 } });
    expect(itemsUnderPlayer(onItem, p1()).map((i) => i.id)).toEqual([I1]);
  });

  it("rejects unknown, distant, full-inventory, and unaffordable pick-ups", () => {
    expect(validatePickUp(onItem, p1(), itemId("nope"))).toEqual({
      ok: false,
      reason: "ITEM_NOT_FOUND",
    });
    expect(validatePickUp(onItem, p1(), I2)).toEqual({ ok: false, reason: "ITEM_NOT_HERE" });
    const full = withP1(onItem, { inventory: ["medkit", "medkit", "medkit"] });
    expect(validatePickUp(full, findPlayer(full, P1)!, I1)).toEqual({
      ok: false,
      reason: "INVENTORY_FULL",
    });
    const tired = withP1(onItem, { actionPoints: 0 });
    expect(validatePickUp(tired, findPlayer(tired, P1)!, I1)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });
});

describe("validateUseItem", () => {
  const carrying = withP1(makeTestState({ players: [P1] }), {
    inventory: ["medkit", "ammo_box"],
    health: 4,
  });

  it("accepts carried items with a useful effect", () => {
    expect(validateUseItem(carrying, findPlayer(carrying, P1)!, "medkit").ok).toBe(true);
    expect(validateUseItem(carrying, findPlayer(carrying, P1)!, "ammo_box").ok).toBe(true);
  });

  it("rejects items not carried, medkits at full health, and unaffordable use", () => {
    const empty = withP1(carrying, { inventory: [] });
    expect(validateUseItem(empty, findPlayer(empty, P1)!, "medkit")).toEqual({
      ok: false,
      reason: "ITEM_NOT_CARRIED",
    });
    const healthy = withP1(carrying, { health: 10 });
    expect(validateUseItem(healthy, findPlayer(healthy, P1)!, "medkit")).toEqual({
      ok: false,
      reason: "HEALTH_ALREADY_FULL",
    });
    const tired = withP1(carrying, { actionPoints: 0 });
    expect(validateUseItem(tired, findPlayer(tired, P1)!, "ammo_box")).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });

  it("removes exactly one matching item from the inventory", () => {
    expect(removeFromInventory(["medkit", "ammo_box", "medkit"], "medkit")).toEqual([
      "ammo_box",
      "medkit",
    ]);
    expect(removeFromInventory(["ammo_box"], "medkit")).toEqual(["ammo_box"]);
  });
});

describe("pick_up and use_item commands", () => {
  it("moves the item into the inventory, spends AP, and removes it from the ground", () => {
    const state = makeTestState({ players: [P1, P2], layout: LOOT });
    const moved = applyCommand(state, { type: "move", playerId: P1, to: { x: 2, y: 1 } });
    if (!moved.ok) throw new Error(moved.reason);
    const result = applyCommand(moved.state, { type: "pick_up", playerId: P1, itemId: I1 });
    if (!result.ok) throw new Error(result.reason);
    expect(findPlayer(result.state, P1)).toMatchObject({ inventory: ["medkit"], actionPoints: 2 });
    expect(result.state.items.map((i) => i.id)).toEqual([I2]);
    expect(result.events).toEqual([
      {
        type: "item_picked_up",
        playerId: P1,
        itemId: I1,
        itemType: "medkit",
        actionPointsSpent: 1,
      },
    ]);
  });

  it("heals with a medkit without exceeding max health", () => {
    const state = withP1(makeTestState({ players: [P1] }), { inventory: ["medkit"], health: 7 });
    const result = applyCommand(state, { type: "use_item", playerId: P1, itemType: "medkit" });
    if (!result.ok) throw new Error(result.reason);
    expect(findPlayer(result.state, P1)).toMatchObject({
      health: 10,
      inventory: [],
      actionPoints: 3,
    });
    expect(result.events).toEqual([
      { type: "item_used", playerId: P1, itemType: "medkit", actionPointsSpent: 1 },
      { type: "player_healed", playerId: P1, amount: 3, health: 10 },
    ]);
  });

  it("adds reserve ammunition with an ammo box", () => {
    const state = withP1(makeTestState({ players: [P1], startingReserveAmmo: 2 }), {
      inventory: ["ammo_box"],
    });
    const result = applyCommand(state, { type: "use_item", playerId: P1, itemType: "ammo_box" });
    if (!result.ok) throw new Error(result.reason);
    expect(findPlayer(result.state, P1)?.reserveAmmo).toBe(8);
    expect(result.events[1]).toEqual({
      type: "ammo_gained",
      playerId: P1,
      rounds: 6,
      reserveAmmo: 8,
    });
  });

  it("is subject to the shared turn checks", () => {
    const state = makeTestState({ players: [P1, P2], layout: LOOT });
    expect(applyCommand(state, { type: "use_item", playerId: P2, itemType: "medkit" })).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
  });
});
