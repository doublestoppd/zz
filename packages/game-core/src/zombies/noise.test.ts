import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createRng } from "../random/rng.js";
import { makeNoise } from "../rules/noise.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { runZombiePhase } from "./zombiePhase.js";
import { decideZombieAction } from "./targetSelection.js";

/**
 * A corridor with a wall between the survivor and the zombie: the zombie cannot see P1
 * (no line of sight) but a shot from P1's tile is within earshot.
 *
 *   ###########
 *   #S....#...#     P1 (1,1), wall at (6,1)
 *   #.....#.Z.#     zombie at (8,2), gap at (6,3)
 *   #.........#
 *   ###########
 */
const CORRIDOR = parseAsciiMap([
  "###########",
  "#S....#...#",
  "#.....#.Z.#",
  "#.........#",
  "###########",
]);
const Z1 = zombieId("z1");
const rng = () => createRng(1);

function zombieAt(state: GameState) {
  const z = state.zombies.find((zz) => zz.id === Z1);
  if (z === undefined) throw new Error("no zombie");
  return z;
}

describe("perception", () => {
  it("does not pursue a survivor it cannot see and waits in silence", () => {
    const state = makeTestState({ players: [P1], layout: CORRIDOR });
    expect(decideZombieAction(state, zombieAt(state))).toEqual({
      kind: "wait",
      investigating: undefined,
    });
  });

  it("pursues a survivor within sight range and line of sight", () => {
    const open = parseAsciiMap(["########", "#S....Z#", "########"]);
    const state = makeTestState({ players: [P1], layout: open });
    expect(decideZombieAction(state, zombieAt(state))).toMatchObject({
      kind: "step",
      reason: "pursue",
    });
    const shortSighted = makeTestState({ players: [P1], layout: open, zombieSightRange: 3 });
    expect(decideZombieAction(shortSighted, zombieAt(shortSighted))).toMatchObject({
      kind: "wait",
    });
  });
});

describe("noise investigation", () => {
  it("a shot creates a noise at the shooter's tile that draws a zombie who cannot see anyone", () => {
    // Give P1 a target in sight to shoot: a second zombie right in front of it.
    const layout = parseAsciiMap([
      "###########",
      "#S..Z.#...#",
      "#.....#.Z.#",
      "#.........#",
      "###########",
    ]);
    const state = makeTestState({ players: [P1], layout, zombieHealth: 1 });
    const shot = applyCommand(state, {
      type: "fire_weapon",
      playerId: P1,
      targetId: zombieId("z1"),
    });
    if (!shot.ok) throw new Error(shot.reason);
    expect(shot.state.noises).toEqual([
      {
        id: "n1",
        position: { x: 1, y: 1 },
        intensity: 8,
        remainingRounds: 2,
        sourceType: "gunfire",
      },
    ]);
    const far = shot.state.zombies.find((z) => z.id === zombieId("z2"));
    expect(far).toBeDefined();
    const decision = decideZombieAction(shot.state, far!);
    expect(decision).toMatchObject({
      kind: "step",
      reason: "investigate",
      investigating: { x: 1, y: 1 },
    });
  });

  it("keeps walking to the remembered spot after the noise is gone and the shooter moved", () => {
    // Short sight so the survivor's new position never comes into view along the corridor.
    const base = makeTestState({ players: [P1], layout: CORRIDOR, zombieSightRange: 2 });
    const noisy = makeNoise(base, { x: 1, y: 1 }, 8, "gunfire").state;
    // Phase 1: hears the noise and starts investigating.
    const one = applyCommand(noisy, { type: "end_turn", playerId: P1 });
    if (!one.ok) throw new Error(one.reason);
    expect(zombieAt(one.state).investigating).toEqual({ x: 1, y: 1 });
    expect(one.events).toContainEqual({
      type: "zombie_investigating",
      zombieId: Z1,
      position: { x: 1, y: 1 },
    });
    // The shooter runs off to the far corner; the noise has decayed away after two phases.
    const moved = applyCommand(one.state, { type: "move", playerId: P1, to: { x: 1, y: 3 } });
    if (!moved.ok) throw new Error(moved.reason);
    const two = applyCommand(moved.state, { type: "end_turn", playerId: P1 });
    if (!two.ok) throw new Error(two.reason);
    expect(two.state.noises).toEqual([]);
    const three = applyCommand(two.state, { type: "end_turn", playerId: P1 });
    if (!three.ok) throw new Error(three.reason);
    // Still heading west for (1,1): three steps along the shortest path through the gap.
    const z = zombieAt(three.state);
    expect(z.investigating).toEqual({ x: 1, y: 1 });
    expect(z.position.x).toBe(6);
  });

  it("forgets the spot on arrival", () => {
    const layout = parseAsciiMap(["#######", "#....Z#", "#S#...#", "#######"]);
    const base = makeTestState({ players: [P1], layout, zombieSightRange: 1 });
    const noisy = makeNoise(base, { x: 3, y: 1 }, 8, "search").state;
    let state = noisy;
    for (let i = 0; i < 3; i += 1) {
      const r = applyCommand(state, { type: "end_turn", playerId: P1 });
      if (!r.ok) throw new Error(r.reason);
      state = r.state;
    }
    expect(zombieAt(state).position.x).toBeLessThanOrEqual(4);
    expect(zombieAt(state).investigating).toBeUndefined();
  });

  it("prefers a visible survivor over any noise", () => {
    const open = parseAsciiMap(["########", "#S....Z#", "#......#", "########"]);
    const base = makeTestState({ players: [P1], layout: open });
    const noisy = makeNoise(base, { x: 6, y: 2 }, 20, "gunfire").state;
    expect(decideZombieAction(noisy, zombieAt(noisy))).toMatchObject({
      kind: "step",
      reason: "pursue",
    });
  });

  it("picks the best-scoring noise and breaks ties by creation order", () => {
    const base = makeTestState({ players: [P1], layout: CORRIDOR });
    const quietNear = makeNoise(base, { x: 8, y: 3 }, 2, "search").state; // score 2 - 1 = 1
    const loudFar = makeNoise(quietNear, { x: 1, y: 3 }, 12, "gunfire").state; // score 12 - 7 = 5
    expect(decideZombieAction(loudFar, zombieAt(loudFar))).toMatchObject({
      investigating: { x: 1, y: 3 },
    });
    const tieA = makeNoise(base, { x: 3, y: 3 }, 10, "search").state; // score 10 - 5 = 5
    const tieB = makeNoise(tieA, { x: 2, y: 3 }, 11, "search").state; // score 11 - 6 = 5
    expect(decideZombieAction(tieB, zombieAt(tieB))).toMatchObject({
      investigating: { x: 3, y: 3 },
    });
  });

  it("decays noises by one round per zombie phase and drops them at zero", () => {
    const base = makeTestState({ players: [P1], layout: CORRIDOR });
    const noisy = makeNoise(base, { x: 1, y: 1 }, 8, "gunfire").state;
    const one = runZombiePhase({ ...noisy, phase: { kind: "zombie_phase" } }, rng());
    expect(one.state.noises[0]?.remainingRounds).toBe(2); // decay happens in the phase transition
    const r1 = applyCommand(noisy, { type: "end_turn", playerId: P1 });
    if (!r1.ok) throw new Error(r1.reason);
    expect(r1.state.noises[0]?.remainingRounds).toBe(1);
    const r2 = applyCommand(r1.state, { type: "end_turn", playerId: P1 });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.state.noises).toEqual([]);
  });

  it("is silent when the intensity is zero", () => {
    const base = makeTestState({ players: [P1], layout: CORRIDOR });
    expect(makeNoise(base, { x: 1, y: 1 }, 0, "search")).toEqual({ state: base, events: [] });
  });
});
