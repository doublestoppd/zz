import { describe, expect, it } from "vitest";
import { zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { legalFireTargets, validateFire, validateReload } from "./combat.js";

/** P1 at (1,1). Zombies: z1 at (3,1) in range, z2 at (7,1) beyond range 4, z3 behind a wall. */
const RANGE = parseAsciiMap(["#########", "#S.Z...Z#", "##......#", "#Z......#", "#########"]);
const Z1 = zombieId("z1");
const Z2 = zombieId("z2");
const Z3 = zombieId("z3");

function withPlayer(state: GameState, patch: Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === P1 ? { ...p, ...patch } : p)) };
}

describe("validateFire", () => {
  const state = makeTestState({ players: [P1], layout: RANGE });
  const p1 = () => findPlayer(state, P1)!;

  it("accepts a visible target in range", () => {
    expect(validateFire(state, p1(), Z1)).toMatchObject({ ok: true, target: { id: Z1 } });
  });

  it("rejects unknown targets, out-of-range targets, and blocked sight", () => {
    expect(validateFire(state, p1(), zombieId("nope"))).toEqual({
      ok: false,
      reason: "TARGET_NOT_FOUND",
    });
    expect(validateFire(state, p1(), Z2)).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
    expect(validateFire(state, p1(), Z3)).toEqual({ ok: false, reason: "NO_LINE_OF_SIGHT" });
  });

  it("rejects an empty magazine and missing action points", () => {
    const empty = withPlayer(state, { weapon: { type: "pistol", loadedAmmo: 0 } });
    expect(validateFire(empty, findPlayer(empty, P1)!, Z1)).toEqual({
      ok: false,
      reason: "WEAPON_EMPTY",
    });
    const tired = withPlayer(state, { actionPoints: 0 });
    expect(validateFire(tired, findPlayer(tired, P1)!, Z1)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });

  it("lists exactly the legal targets", () => {
    expect(legalFireTargets(state, p1()).map((z) => z.id)).toEqual([Z1]);
  });
});

describe("validateReload", () => {
  const state = makeTestState({ players: [P1], startingReserveAmmo: 4 });

  it("loads what the magazine can take, limited by reserve", () => {
    const half = withPlayer(state, { weapon: { type: "pistol", loadedAmmo: 1 } });
    expect(validateReload(half, findPlayer(half, P1)!)).toMatchObject({
      ok: true,
      roundsLoaded: 4,
    });
    const low = withPlayer(state, { weapon: { type: "pistol", loadedAmmo: 5 } });
    expect(validateReload(low, findPlayer(low, P1)!)).toMatchObject({ ok: true, roundsLoaded: 1 });
  });

  it("rejects a full magazine, an empty reserve, and missing action points", () => {
    expect(validateReload(state, findPlayer(state, P1)!)).toEqual({
      ok: false,
      reason: "MAGAZINE_FULL",
    });
    const dry = withPlayer(state, { weapon: { type: "pistol", loadedAmmo: 0 }, reserveAmmo: 0 });
    expect(validateReload(dry, findPlayer(dry, P1)!)).toEqual({
      ok: false,
      reason: "NO_RESERVE_AMMO",
    });
    const tired = withPlayer(state, { weapon: { type: "pistol", loadedAmmo: 0 }, actionPoints: 0 });
    expect(validateReload(tired, findPlayer(tired, P1)!)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });
});
