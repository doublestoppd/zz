import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { containerId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { findPlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { rollSearchLoot, searchableContainersInReach, validateSearch } from "./search.js";

/** P1 at (1,1): c1 adjacent at (2,1), c2 out of reach at (4,1), c3 diagonal at (2,2). */
const LAYOUT = parseAsciiMap(["######", "#SC.C#", "#SC..#", "######"]);
const C1 = containerId("c1");
const C2 = containerId("c2");
const C3 = containerId("c3");

function withP1(state: GameState, patch: Partial<GameState["players"][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.id === P1 ? { ...p, ...patch } : p)) };
}

describe("validateSearch", () => {
  const state = makeTestState({ players: [P1], layout: LAYOUT });
  const p1 = () => findPlayer(state, P1)!;

  it("accepts adjacent (including diagonal) unsearched containers and lists them", () => {
    expect(validateSearch(state, p1(), C1)).toMatchObject({ ok: true, cost: 2 });
    expect(validateSearch(state, p1(), C3)).toMatchObject({ ok: true });
    expect(searchableContainersInReach(state, p1()).map((c) => c.id)).toEqual([C1, C3]);
  });

  it("rejects unknown, out-of-reach, already-searched, and unaffordable searches", () => {
    expect(validateSearch(state, p1(), containerId("nope"))).toEqual({
      ok: false,
      reason: "CONTAINER_NOT_FOUND",
    });
    expect(validateSearch(state, p1(), C2)).toEqual({
      ok: false,
      reason: "CONTAINER_OUT_OF_REACH",
    });
    const searched: GameState = {
      ...state,
      containers: state.containers.map((c) => (c.id === C1 ? { ...c, searched: true } : c)),
    };
    expect(validateSearch(searched, findPlayer(searched, P1)!, C1)).toEqual({
      ok: false,
      reason: "CONTAINER_ALREADY_SEARCHED",
    });
    const tired = withP1(state, { actionPoints: 1 });
    expect(validateSearch(tired, findPlayer(tired, P1)!, C1)).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });
});

describe("rollSearchLoot", () => {
  it("depends only on the seed, the container id, and its category", () => {
    const a = makeTestState({ players: [P1], layout: LAYOUT, seed: 11 });
    const b = makeTestState({ players: [P1, P2], layout: LAYOUT, seed: 11 });
    const c = makeTestState({ players: [P1], layout: LAYOUT, seed: 12 });
    expect(rollSearchLoot(a, a.containers[0]!)).toEqual(rollSearchLoot(b, b.containers[0]!));
    const differs = [0, 1, 2].some(
      (i) =>
        JSON.stringify(rollSearchLoot(a, a.containers[i]!)) !==
        JSON.stringify(rollSearchLoot(c, c.containers[i]!)),
    );
    expect(differs).toBe(true);
  });

  it("draws only from the category's table and within its roll bounds", () => {
    const state = makeTestState({ players: [P1], layout: LAYOUT });
    for (let seed = 0; seed < 40; seed += 1) {
      const s = { ...state, seed };
      const clinic = { ...state.containers[0]!, category: "clinic" as const };
      const loot = rollSearchLoot(s, clinic);
      expect(loot.length).toBeLessThanOrEqual(2);
      expect(loot.length).toBeGreaterThanOrEqual(1);
      expect(loot.every((item) => item === "medkit" || item === "bandage")).toBe(true);
    }
  });
});

describe("search command", () => {
  it("pays the cost, marks the container searched, and carries the loot", () => {
    const state = makeTestState({ players: [P1], layout: LAYOUT, seed: 3 });
    const result = applyCommand(state, { type: "search", playerId: P1, containerId: C1 });
    if (!result.ok) throw new Error(result.reason);
    const p1 = findPlayer(result.state, P1)!;
    const event = result.events[0];
    expect(event?.type).toBe("container_searched");
    if (event?.type !== "container_searched") throw new Error("no event");
    expect(p1.actionPoints).toBe(2);
    expect(p1.inventory).toEqual(event.carried);
    expect(event.dropped).toEqual([]);
    expect(result.state.containers.find((c) => c.id === C1)?.searched).toBe(true);
    expect(applyCommand(result.state, { type: "search", playerId: P1, containerId: C1 })).toEqual({
      ok: false,
      reason: "CONTAINER_ALREADY_SEARCHED",
    });
  });

  it("is deterministic regardless of search order", () => {
    const state = makeTestState({ players: [P1], layout: LAYOUT, seed: 5, maxActionPoints: 8 });
    const searchC1 = { type: "search", playerId: P1, containerId: C1 } as const;
    const searchC3 = { type: "search", playerId: P1, containerId: C3 } as const;
    const run = (
      first: typeof searchC1 | typeof searchC3,
      second: typeof searchC1 | typeof searchC3,
    ) => {
      const a = applyCommand(state, first);
      if (!a.ok) throw new Error(a.reason);
      const b = applyCommand(a.state, second);
      if (!b.ok) throw new Error(b.reason);
      return [...findPlayer(b.state, P1)!.inventory].sort();
    };
    expect(run(searchC1, searchC3)).toEqual(run(searchC3, searchC1));
  });

  it("drops loot on the container's tile when the inventory is full", () => {
    const base = makeTestState({ players: [P1], layout: LAYOUT, seed: 3, inventoryCapacity: 0 });
    const result = applyCommand(base, { type: "search", playerId: P1, containerId: C1 });
    if (!result.ok) throw new Error(result.reason);
    const event = result.events[0];
    if (event?.type !== "container_searched") throw new Error("no event");
    expect(event.carried).toEqual([]);
    expect(event.dropped).toEqual(event.found);
    expect(
      result.state.items.filter((i) => i.position.x === 2 && i.position.y === 1).map((i) => i.type),
    ).toEqual(event.found);
    expect(findPlayer(result.state, P1)?.inventory).toEqual([]);
  });

  it("is subject to the shared turn checks", () => {
    const state = makeTestState({ players: [P1, P2], layout: LAYOUT });
    expect(applyCommand(state, { type: "search", playerId: P2, containerId: C1 })).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
    });
  });
});
