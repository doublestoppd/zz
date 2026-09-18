import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { makeNoise } from "../rules/noise.js";
import type { GameState, ZombieType } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { validateMelee } from "../rules/combat.js";
import { findPlayer } from "../state/players.js";

const Z1 = zombieId("z1");
/** P1 at (1,1), a zombie six tiles away in an open corridor. */
const CORRIDOR = parseAsciiMap(["#########", "#S.....Z#", "#.......#", "#########"]);

function ofType(state: GameState, type: ZombieType): GameState {
  return { ...state, zombies: state.zombies.map((z) => ({ ...z, type })) };
}

function endTurn(state: GameState) {
  const r = applyCommand(state, { type: "end_turn", playerId: P1 });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("zombie archetypes", () => {
  it("rolls types from the spawn table deterministically", () => {
    const table = [
      { type: "walker" as const, weight: 1 },
      { type: "runner" as const, weight: 1 },
      { type: "brute" as const, weight: 1 },
    ];
    const layout = parseAsciiMap(["#########", "#S.ZZZZZ#", "#..ZZZZZ#", "#########"]);
    const a = makeTestState({ players: [P1], layout, zombieSpawnTable: table, seed: 9 });
    const b = makeTestState({ players: [P1], layout, zombieSpawnTable: table, seed: 9 });
    expect(a.zombies.map((z) => z.type)).toEqual(b.zombies.map((z) => z.type));
    expect(new Set(a.zombies.map((z) => z.type)).size).toBeGreaterThan(1);
    // Health follows the rolled type, so a brute never starts with walker health.
    for (const z of a.zombies) expect(z.health).toBe(a.rules.zombieDefinitions[z.type].maxHealth);
  });

  it("a runner closes two tiles a round where a walker closes one", () => {
    const walker = endTurn(makeTestState({ players: [P1], layout: CORRIDOR }));
    expect(walker.state.zombies[0]?.position).toEqual({ x: 6, y: 1 });
    const runner = endTurn(ofType(makeTestState({ players: [P1], layout: CORRIDOR }), "runner"));
    expect(runner.state.zombies[0]?.position).toEqual({ x: 5, y: 1 });
    expect(runner.events.filter((e) => e.type === "zombie_moved")).toHaveLength(2);
  });

  it("a runner still stops to attack after its first step", () => {
    const close = parseAsciiMap(["#####", "#S.Z#", "#####"]);
    const runner = endTurn(ofType(makeTestState({ players: [P1], layout: close }), "runner"));
    // Step to (2,1), then adjacent: attack instead of a second step.
    expect(runner.state.zombies[0]?.position).toEqual({ x: 2, y: 1 });
    expect(runner.events.some((e) => e.type === "zombie_attacked")).toBe(true);
    expect(findPlayer(runner.state, P1)?.health).toBe(9);
  });

  it("a brute steps only in even rounds but attacks and remembers in any round", () => {
    // Five tiles apart: inside the brute's sight range of 5.
    const near = parseAsciiMap(["########", "#S....Z#", "########"]);
    const brute = ofType(makeTestState({ players: [P1], layout: near }), "brute");
    const round1 = endTurn(brute); // round 1 is odd: no step
    expect(round1.state.zombies[0]?.position).toEqual({ x: 6, y: 1 });
    expect(round1.state.round).toBe(2);
    const round2 = endTurn(round1.state);
    expect(round2.state.zombies[0]?.position).toEqual({ x: 5, y: 1 });
    // Adjacent in an odd round: it still swings.
    const adjacent = ofType(
      makeTestState({ players: [P1], layout: parseAsciiMap(["####", "#SZ#", "####"]) }),
      "brute",
    );
    const hit = endTurn(adjacent);
    expect(hit.events).toContainEqual({
      type: "zombie_attacked",
      zombieId: Z1,
      targetId: P1,
      damage: 4,
    });
    // A heard noise is remembered even while resting.
    const deaf = ofType(
      makeTestState({
        players: [P1],
        layout: parseAsciiMap([
          "#########",
          "#S..#..Z#",
          "#...#...#",
          "#...#...#",
          "#.......#",
          "#########",
        ]),
        zombieSightRange: 2,
      }),
      "brute",
    );
    const noisy = makeNoise(deaf, { x: 1, y: 1 }, 10, "gunfire").state;
    const rested = endTurn(noisy);
    expect(rested.state.zombies[0]?.position).toEqual({ x: 7, y: 1 });
    expect(rested.state.zombies[0]?.investigating).toEqual({ x: 1, y: 1 });
  });

  it("a brute cannot be knocked back; a walker can", () => {
    const layout = parseAsciiMap(["#######", "#SZ...#", "#######"]);
    const walker = makeTestState({ players: [P1], layout, startingMeleeWeapon: "bat" });
    expect(validateMelee(walker, findPlayer(walker, P1)!, Z1)).toMatchObject({
      ok: true,
      knockbackTo: { x: 3, y: 1 },
    });
    const brute = ofType(walker, "brute");
    expect(validateMelee(brute, findPlayer(brute, P1)!, Z1)).toMatchObject({
      ok: true,
      knockbackTo: undefined,
    });
  });

  it("keeps the same phase deterministic across types", () => {
    const state = ofType(makeTestState({ players: [P1], layout: CORRIDOR }), "runner");
    expect(endTurn(state)).toEqual(endTurn(state));
  });
});
