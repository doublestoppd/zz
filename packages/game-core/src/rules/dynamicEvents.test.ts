import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createRng } from "../random/rng.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { rollDynamicEvent } from "./dynamicEvents.js";

/** Open ground with two far spawns; the zombies there never see P1. */
const FIELD = parseAsciiMap([
  "##############",
  "#S...........#",
  "#............#",
  "#.......#....#",
  "#.......#..Z.#",
  "#.......#...Z#",
  "##############",
]);

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function atThreat(state: GameState, threat: number): GameState {
  return { ...state, threat };
}

describe("dynamic events", () => {
  it("never fire when the level's chance is zero or too soon after the last one", () => {
    const quiet = makeTestState({ players: [P1], layout: FIELD });
    expect(rollDynamicEvent(quiet, createRng(1))).toEqual({ state: quiet, events: [] });
    const eager = makeTestState({
      players: [P1],
      layout: FIELD,
      dynamicEvents: { chancePerLevel: [100, 100, 100, 100, 100], minRoundsBetween: 3 },
    });
    const recent = { ...eager, round: 4, lastEventRound: 3 };
    expect(rollDynamicEvent(recent, createRng(1)).events).toEqual([]);
    const later = { ...eager, round: 6, lastEventRound: 3 };
    expect(rollDynamicEvent(later, createRng(1)).events.length).toBeGreaterThan(0);
  });

  it("a car alarm is a long, loud noise at a spawn, through the noise system", () => {
    const state = makeTestState({
      players: [P1],
      layout: FIELD,
      zombieSightRange: 2,
      dynamicEvents: {
        chancePerLevel: [100, 100, 100, 100, 100],
        pool: [{ type: "car_alarm", weight: 1, minThreat: 0 }],
      },
    });
    const { state: after, events } = rollDynamicEvent(state, createRng(7));
    expect(events[0]).toMatchObject({ type: "dynamic_event", event: "car_alarm" });
    expect(after.noises).toHaveLength(1);
    expect(after.noises[0]).toMatchObject({
      intensity: 15,
      remainingRounds: 3,
      sourceType: "alarm",
    });
    expect(after.heat).toBe(15);
    expect(after.lastEventRound).toBe(state.round);
    // Zombies investigate it like any noise: one roaming out of earshot of P1 heads there.
    const roaming: GameState = {
      ...after,
      zombies: after.zombies.map((z, i) => (i === 0 ? { ...z, position: { x: 6, y: 5 } } : z)),
    };
    const drawn = must(applyCommand({ ...roaming, threat: 0 }, { type: "end_turn", playerId: P1 }));
    expect(drawn.events.some((e) => e.type === "zombie_investigating")).toBe(true);
  });

  it("a horde is a reinforcement wave from the current threat table", () => {
    // A sharp-eyed zombie walks off the only spawn, freeing it for the horde.
    const state = atThreat(
      makeTestState({
        players: [P1],
        layout: parseAsciiMap(["############", "#S........Z#", "############"]),
        zombieSightRange: 12,
        // Quiet at level 0, so the round loop itself fires nothing while the zombie walks.
        dynamicEvents: {
          chancePerLevel: [0, 0, 100, 100, 100],
          pool: [{ type: "horde", weight: 1, minThreat: 0 }],
          hordeSize: 3,
        },
      }),
      2,
    );
    const moved = must(applyCommand(state, { type: "end_turn", playerId: P1 })).state;
    expect(moved.zombies[0]?.position).toEqual({ x: 9, y: 1 });
    const { state: after, events } = rollDynamicEvent(
      { ...moved, threat: 2, lastEventRound: 0 },
      createRng(3),
    );
    const spawned = events.filter((e) => e.type === "zombie_spawned");
    // One free spot, so the horde is capped by the board, never by luck.
    expect(spawned).toHaveLength(1);
    expect(after.zombies.length).toBe(moved.zombies.length + 1);
    expect(spawned[0]).toMatchObject({ zombieType: "runner", position: { x: 10, y: 1 } });
  });

  it("a supply cache drops loot a short detour away", () => {
    const state = makeTestState({
      players: [P1],
      layout: FIELD,
      dynamicEvents: {
        chancePerLevel: [100, 100, 100, 100, 100],
        pool: [{ type: "supply_cache", weight: 1, minThreat: 0 }],
        cacheSize: 2,
        cacheMinDistance: 2,
        cacheMaxDistance: 4,
      },
    });
    const { state: after, events } = rollDynamicEvent(state, createRng(5));
    expect(after.items).toHaveLength(2);
    const spot = after.items[0]!.position;
    const d = Math.max(Math.abs(spot.x - 1), Math.abs(spot.y - 1));
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(4);
    expect(events.filter((e) => e.type === "item_dropped")).toHaveLength(2);
    expect(after.items.every((i) => i.type === "ammo_box")).toBe(true);
  });

  it("respects minThreat when drawing from the pool and replays from the seed", () => {
    const state = makeTestState({
      players: [P1],
      layout: FIELD,
      dynamicEvents: {
        chancePerLevel: [100, 100, 100, 100, 100],
        pool: [
          { type: "horde", weight: 100, minThreat: 3 },
          { type: "car_alarm", weight: 1, minThreat: 0 },
        ],
      },
    });
    for (let seed = 0; seed < 5; seed += 1) {
      const { events } = rollDynamicEvent(state, createRng(seed));
      expect(events[0]).toMatchObject({ event: "car_alarm" });
    }
    expect(rollDynamicEvent(state, createRng(9))).toEqual(rollDynamicEvent(state, createRng(9)));
  });

  it("fires from the round loop after threat, before the next round starts", () => {
    const state = makeTestState({
      players: [P1],
      layout: FIELD,
      dynamicEvents: {
        chancePerLevel: [100, 100, 100, 100, 100],
        pool: [{ type: "car_alarm", weight: 1, minThreat: 0 }],
      },
    });
    const r = must(applyCommand(state, { type: "end_turn", playerId: P1 }));
    const types = r.events.map((e) => e.type);
    expect(types.indexOf("dynamic_event")).toBeLessThan(types.indexOf("round_started"));
    expect(r.state.lastEventRound).toBe(1);
    const again = must(applyCommand(r.state, { type: "end_turn", playerId: P1 }));
    expect(again.events.some((e) => e.type === "dynamic_event")).toBe(false); // too soon
  });
});
