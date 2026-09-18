import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { makeNoise } from "./noise.js";
import { computeThreat } from "./threat.js";

/** P1 in the west, a reinforcement spawn far east behind a wall so nothing sees anyone. */
const FIELD = parseAsciiMap([
  "############",
  "#S...#.....#",
  "#....#.....#",
  "#..........#",
  "#....#....Z#",
  "############",
]);

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function rounds(state: GameState, n: number) {
  let current = state;
  const events = [];
  for (let i = 0; i < n; i += 1) {
    const r = must(applyCommand(current, { type: "end_turn", playerId: P1 }));
    current = r.state;
    events.push(...r.events);
  }
  return { state: current, events };
}

describe("threat level", () => {
  it("rises with rounds, noise, and objective steps, and is capped", () => {
    const base = makeTestState({
      players: [P1],
      layout: FIELD,
      threat: { roundsPerLevel: 2, heatPerLevel: 10 },
    });
    expect(computeThreat(base)).toBe(0);
    expect(computeThreat({ ...base, round: 3 })).toBe(1);
    expect(computeThreat({ ...base, round: 5 })).toBe(2);
    const noisy = makeNoise(base, { x: 1, y: 1 }, 25, "gunfire").state;
    expect(noisy.heat).toBe(25);
    expect(computeThreat(noisy)).toBe(2);
    const advanced = { ...base, objective: { ...base.objective, current: 1 } };
    expect(computeThreat(advanced)).toBe(1);
    expect(computeThreat({ ...noisy, round: 99 })).toBe(4);
  });

  it("announces level changes at the end of the round", () => {
    const base = makeTestState({ players: [P1], layout: FIELD, threat: { roundsPerLevel: 2 } });
    const { state, events } = rounds(base, 2);
    expect(state.threat).toBe(1);
    expect(events).toContainEqual({ type: "threat_changed", level: 1, previous: 0 });
    expect(events.filter((e) => e.type === "threat_changed")).toHaveLength(1);
  });
});

describe("reinforcements", () => {
  it("never arrive at level 0 and follow the level's schedule afterwards", () => {
    // A sharp-eyed zombie leaves its spawn at once, so the spot is free for a wave.
    const base = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["##########", "#S......Z#", "##########"]),
      zombieSightRange: 8,
      threat: {
        roundsPerLevel: 1,
        reinforcementInterval: [0, 2, 2, 2, 1],
        reinforcementCount: [0, 1, 1, 2, 2],
      },
    });
    // Round 1 ends at level 0: nothing. Round 2 ends at level 1 and 2 % 2 === 0: one wave.
    const r1 = rounds(base, 1);
    expect(r1.state.zombies).toHaveLength(1);
    const r2 = rounds(r1.state, 1);
    expect(r2.state.zombies).toHaveLength(2);
    expect(r2.events).toContainEqual(
      expect.objectContaining({ type: "zombie_spawned", zombieId: "z2", zombieType: "runner" }),
    );
    expect(r2.state.zombieCounter).toBe(2);
  });

  it("rolls types from the level's table and spawns only on free, distant spots", () => {
    const layout = parseAsciiMap(["#######", "#S..Z.#", "#######"]);
    const close = makeTestState({
      players: [P1],
      layout,
      threat: { roundsPerLevel: 1, reinforcementInterval: [0, 1, 1, 1, 1], spawnMinDistance: 5 },
    });
    // The only spawn is three tiles from P1: too close, so no wave; the zombie itself walks over.
    const r = rounds(close, 2);
    expect(r.state.zombies).toHaveLength(1);
    expect(r.events.some((e) => e.type === "zombie_spawned")).toBe(false);

    // A sharp-eyed zombie walks off its spawn toward P1, freeing the spot seven tiles away.
    const brutes = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["##########", "#S......Z#", "##########"]),
      zombieSightRange: 8,
      threat: {
        roundsPerLevel: 1,
        maxLevel: 4,
        reinforcementInterval: [0, 1, 1, 1, 1],
        spawnTables: [
          [{ type: "walker", weight: 1 }],
          [{ type: "brute", weight: 1 }],
          [{ type: "brute", weight: 1 }],
          [{ type: "brute", weight: 1 }],
          [{ type: "brute", weight: 1 }],
        ],
      },
    });
    const second = rounds(brutes, 1);
    const spawned = second.events.filter((e) => e.type === "zombie_spawned");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ zombieType: "brute", position: { x: 8, y: 1 } });
    expect(second.state.zombies.map((z) => [z.id, z.type, z.position.x])).toEqual([
      ["z1", "walker", 7],
      ["z2", "brute", 8],
    ]);
  });

  it("is deterministic and never spoils a victory already earned", () => {
    const base = makeTestState({
      players: [P1],
      layout: FIELD,
      threat: { roundsPerLevel: 1, reinforcementInterval: [0, 1, 1, 1, 1] },
    });
    expect(rounds(base, 3)).toEqual(rounds(base, 3));
    const zone = parseAsciiMap(["#####", "#SE.#", "#.Z.#", "#####"]);
    const win = makeTestState({
      players: [P1],
      layout: zone,
      holdoutRounds: 0,
      threat: { roundsPerLevel: 1, reinforcementInterval: [0, 1, 1, 1, 1] },
    });
    const inZone: GameState = {
      ...win,
      players: win.players.map((p) => ({ ...p, position: { x: 2, y: 1 } })),
    };
    const r = must(applyCommand(inZone, { type: "end_turn", playerId: P1 }));
    expect(r.state.phase).toEqual({ kind: "finished", outcome: "victory" });
    expect(r.events.some((e) => e.type === "zombie_spawned")).toBe(false);
  });
});
