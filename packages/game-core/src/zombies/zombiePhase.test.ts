import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createRng } from "../random/rng.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { runZombiePhase } from "./zombiePhase.js";

const rng = () => createRng(1);

describe("runZombiePhase", () => {
  it("moves each zombie one step and reports the move", () => {
    const layout = parseAsciiMap(["#######", "#S...Z#", "#######"]);
    const state = makeTestState({ players: [P1], layout });
    const { state: after, events } = runZombiePhase(state, rng());
    expect(after.zombies[0]?.position).toEqual({ x: 4, y: 1 });
    expect(events).toEqual([
      { type: "zombie_moved", zombieId: "z1", from: { x: 5, y: 1 }, to: { x: 4, y: 1 } },
    ]);
  });

  it("attacks an adjacent survivor for the zombie type's damage", () => {
    const layout = parseAsciiMap(["#####", "#SZ.#", "#####"]);
    const state = makeTestState({ players: [P1], layout, zombieDamage: 3 });
    const { state: after, events } = runZombiePhase(state, rng());
    expect(findPlayer(after, P1)?.health).toBe(7);
    expect(events).toEqual([
      { type: "zombie_attacked", zombieId: "z1", targetId: P1, damage: 3 },
      { type: "entity_damaged", entityId: P1, damage: 3, remainingHealth: 7 },
    ]);
  });

  it("downs a survivor at zero health and never goes below zero", () => {
    const layout = parseAsciiMap(["#####", "#SZ.#", "#####"]);
    const base = makeTestState({ players: [P1], layout, zombieDamage: 4 });
    const weak: GameState = {
      ...base,
      players: base.players.map((p) => ({ ...p, health: 3 })),
    };
    const { state: after, events } = runZombiePhase(weak, rng());
    expect(findPlayer(after, P1)).toMatchObject({ health: 0, status: "down" });
    expect(events.map((e) => e.type)).toEqual([
      "zombie_attacked",
      "entity_damaged",
      "player_downed",
    ]);
  });

  it("lets later zombies see the board as earlier ones left it", () => {
    // Two zombies queued in a corridor: the front one steps and the rear one follows into its tile.
    const layout = parseAsciiMap(["########", "#S...ZZ#", "########"]);
    const state = makeTestState({ players: [P1], layout });
    const { state: after } = runZombiePhase(state, rng());
    expect(after.zombies.map((z) => z.position)).toEqual([
      { x: 4, y: 1 },
      { x: 5, y: 1 },
    ]);
  });
});

describe("zombies in the round loop", () => {
  it("runs the zombie phase after the last player ends their turn", () => {
    const layout = parseAsciiMap(["#######", "#S...Z#", "#######"]);
    const state = makeTestState({ players: [P1], layout });
    const result = applyCommand(state, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.zombies[0]?.position).toEqual({ x: 4, y: 1 });
    expect(result.state.round).toBe(2);
    expect(result.events.some((e) => e.type === "zombie_moved")).toBe(true);
  });

  it("skips down survivors in turn order", () => {
    const base = makeTestState({ players: [P1, P2] });
    const p2Down: GameState = {
      ...base,
      players: base.players.map((p) => (p.id === P2 ? { ...p, status: "down", health: 0 } : p)),
    };
    const result = applyCommand(p2Down, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.round).toBe(2);
    expect(result.state.phase).toEqual({ kind: "player_turn", activePlayerId: P1 });
    expect(applyCommand(result.state, { type: "end_turn", playerId: P2 })).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
  });

  it("ends the match in defeat when every survivor is down", () => {
    const layout = parseAsciiMap(["#####", "#SZ.#", "#####"]);
    const base = makeTestState({ players: [P1], layout, zombieDamage: 10 });
    const result = applyCommand(base, { type: "end_turn", playerId: P1 });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.phase).toEqual({ kind: "finished", outcome: "defeat" });
    expect(result.events.at(-1)).toEqual({ type: "match_ended", outcome: "defeat" });
    expect(applyCommand(result.state, { type: "end_turn", playerId: P1 })).toEqual({
      ok: false,
      reason: "MATCH_FINISHED",
    });
  });

  it("writes the rng cursor back and stays deterministic across the zombie phase", () => {
    const layout = parseAsciiMap(["#######", "#S...Z#", "#S..Z.#", "#######"]);
    const run = (): GameState => {
      const r = applyCommand(makeTestState({ players: [P1, P2], layout }), {
        type: "end_turn",
        playerId: P1,
      });
      if (!r.ok) throw new Error(r.reason);
      const r2 = applyCommand(r.state, { type: "end_turn", playerId: P2 });
      if (!r2.ok) throw new Error(r2.reason);
      return r2.state;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.rngState).toBe(makeTestState({ players: [P1, P2], layout }).rngState);
  });
});
