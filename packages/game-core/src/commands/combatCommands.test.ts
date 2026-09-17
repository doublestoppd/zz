import { describe, expect, it } from "vitest";
import { zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { applyCommand } from "./applyCommand.js";

const CLOSE = parseAsciiMap(["#######", "#S..Z.#", "#S....#", "#######"]);
const Z1 = zombieId("z1");

function run(state: GameState, ...commands: Parameters<typeof applyCommand>[1][]): GameState {
  return commands.reduce((s, c) => {
    const r = applyCommand(s, c);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }, state);
}

describe("fire_weapon", () => {
  it("spends action points and ammo, damages the target, and reports it", () => {
    const state = makeTestState({ players: [P1], layout: CLOSE, zombieHealth: 5 });
    const result = applyCommand(state, { type: "fire_weapon", playerId: P1, targetId: Z1 });
    if (!result.ok) throw new Error(result.reason);
    expect(findPlayer(result.state, P1)).toMatchObject({
      actionPoints: 3,
      weapon: { type: "pistol", loadedAmmo: 5 },
    });
    expect(result.state.zombies[0]?.health).toBe(3);
    expect(result.events).toEqual([
      {
        type: "weapon_fired",
        playerId: P1,
        weaponType: "pistol",
        targetId: Z1,
        actionPointsSpent: 1,
      },
      { type: "entity_damaged", entityId: Z1, damage: 2, remainingHealth: 3 },
    ]);
  });

  it("removes a zombie that reaches zero health", () => {
    const state = makeTestState({ players: [P1], layout: CLOSE, zombieHealth: 3 });
    const after = run(
      state,
      { type: "fire_weapon", playerId: P1, targetId: Z1 },
      { type: "fire_weapon", playerId: P1, targetId: Z1 },
    );
    expect(after.zombies).toEqual([]);
    const second = applyCommand(run(state, { type: "fire_weapon", playerId: P1, targetId: Z1 }), {
      type: "fire_weapon",
      playerId: P1,
      targetId: Z1,
    });
    if (!second.ok) throw new Error(second.reason);
    expect(second.events.at(-1)).toEqual({ type: "entity_died", entityId: Z1 });
    expect(applyCommand(after, { type: "fire_weapon", playerId: P1, targetId: Z1 })).toEqual({
      ok: false,
      reason: "TARGET_NOT_FOUND",
    });
  });

  it("is subject to the shared turn checks", () => {
    const state = makeTestState({ players: [P1, P2], layout: CLOSE });
    expect(applyCommand(state, { type: "fire_weapon", playerId: P2, targetId: Z1 })).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
  });
});

describe("reload", () => {
  it("refills the magazine from reserve and spends action points", () => {
    const state = makeTestState({ players: [P1], layout: CLOSE, startingReserveAmmo: 10 });
    const fired = run(
      state,
      { type: "fire_weapon", playerId: P1, targetId: Z1 },
      { type: "fire_weapon", playerId: P1, targetId: Z1 },
    );
    const result = applyCommand(fired, { type: "reload", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(findPlayer(result.state, P1)).toMatchObject({
      actionPoints: 1,
      weapon: { loadedAmmo: 6 },
      reserveAmmo: 8,
    });
    expect(result.events).toEqual([
      {
        type: "weapon_reloaded",
        playerId: P1,
        loadedAmmo: 6,
        reserveAmmo: 8,
        actionPointsSpent: 1,
      },
    ]);
  });

  it("rejects reloading a full magazine", () => {
    const state = makeTestState({ players: [P1], layout: CLOSE });
    expect(applyCommand(state, { type: "reload", playerId: P1 })).toEqual({
      ok: false,
      reason: "MAGAZINE_FULL",
    });
  });
});
