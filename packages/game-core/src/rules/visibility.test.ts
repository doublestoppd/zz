import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { barrierId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { isVisible, revealExplored, visibleTiles } from "./visibility.js";

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function exploredCount(state: GameState): number {
  return state.explored.flat().filter(Boolean).length;
}

describe("visibility", () => {
  it("sees within range and line of sight; walls hide what lies behind them", () => {
    const layout = parseAsciiMap(["#########", "#S..#...#", "#...#...#", "#########"]);
    const state = makeTestState({ players: [P1], layout, visionRange: 8 });
    expect(isVisible(state, { x: 3, y: 1 })).toBe(true);
    expect(isVisible(state, { x: 4, y: 1 })).toBe(true); // the wall itself is seen
    expect(isVisible(state, { x: 6, y: 1 })).toBe(false); // behind it
    expect(isVisible(state, { x: 6, y: 2 })).toBe(false);
    const short = makeTestState({ players: [P1], layout, visionRange: 1 });
    expect(isVisible(short, { x: 3, y: 1 })).toBe(false);
    expect(isVisible(short, { x: 2, y: 2 })).toBe(true); // diagonal counts as one
  });

  it("does not reveal the whole map at match start", () => {
    const state = makeTestState({
      players: [P1],
      layout: parseAsciiMap(["#########", "#S..#...#", "#...#..E#", "#########"]),
      visionRange: 8,
    });
    const total = state.map.width * state.map.height;
    expect(exploredCount(state)).toBeLessThan(total);
    // The objective's zone is known from the briefing even though nobody has seen it.
    expect(state.explored[2]?.[7]).toBe(true);
    expect(state.explored[1]?.[6]).toBe(false);
  });

  it("a closed door hides the room; opening it reveals it and the memory persists", () => {
    const layout = parseAsciiMap(["#######", "#S+...#", "#######"]);
    const state = makeTestState({ players: [P1], layout, visionRange: 8 });
    expect(isVisible(state, { x: 4, y: 1 })).toBe(false);
    expect(state.explored[1]?.[4]).toBe(false);
    const opened = must(
      applyCommand(state, { type: "open_door", playerId: P1, barrierId: barrierId("b1") }),
    );
    expect(isVisible(opened.state, { x: 5, y: 1 })).toBe(true);
    expect(opened.state.explored[1]?.[5]).toBe(true);
    const closed = must(
      applyCommand(opened.state, { type: "close_door", playerId: P1, barrierId: barrierId("b1") }),
    );
    expect(isVisible(closed.state, { x: 5, y: 1 })).toBe(false);
    // Seen once, remembered for good: explored, but the view is stale now.
    expect(closed.state.explored[1]?.[5]).toBe(true);
  });

  it("shares exploration across the team and updates after moving", () => {
    const layout = parseAsciiMap([
      "###########",
      "#S...#....#",
      "#S...#....#",
      "#....+....#",
      "###########",
    ]);
    const state = makeTestState({ players: [P1, P2], layout, visionRange: 3, maxActionPoints: 6 });
    const before = exploredCount(state);
    expect(isVisible(state, { x: 8, y: 1 })).toBe(false);
    // P1 walks to the doorway: the far room comes into the team's view and its map.
    const moved = must(applyCommand(state, { type: "move", playerId: P1, to: { x: 4, y: 3 } }));
    expect(exploredCount(moved.state)).toBeGreaterThan(before);
    expect(isVisible(moved.state, { x: 7, y: 3 })).toBe(false); // the door is shut
    const opened = must(
      applyCommand(moved.state, { type: "open_door", playerId: P1, barrierId: barrierId("b1") }),
    );
    expect(isVisible(opened.state, { x: 7, y: 3 })).toBe(true);
    // The union includes tiles only P2 can see.
    expect(visibleTiles(opened.state)).toContainEqual({ x: 1, y: 1 });
  });

  it("revealExplored is idempotent and returns the same object when nothing changes", () => {
    const state = makeTestState({ players: [P1] });
    expect(revealExplored(state)).toBe(state);
  });
});
