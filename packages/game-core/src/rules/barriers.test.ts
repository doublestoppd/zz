import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import { barrierId, zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { makeNoise } from "../rules/noise.js";
import type { GameState } from "../state/types.js";
import { makeTestState, P1 } from "../testing/makeTestState.js";
import { decideZombieAction } from "../zombies/targetSelection.js";
import { barrierOptions } from "./barriers.js";
import { validateFire } from "./combat.js";
import { hasLineOfSight } from "./lineOfSight.js";
import { legalMoveDestinations, validateMove } from "./movement.js";

const B1 = barrierId("b1");
const Z1 = zombieId("z1");

/** P1 at (1,1), a door at (3,1), open floor beyond. */
const corridor = (door: "+" | "O" | "K" | "W") =>
  makeTestState({ players: [P1], layout: parseAsciiMap(["#######", `#S.${door}..#`, "#######"]) });

function playerAt(state: GameState, x: number, y: number): GameState {
  return { ...state, players: state.players.map((p) => ({ ...p, position: { x, y } })) };
}

function carrying(state: GameState, ...items: ("key" | "bandage")[]): GameState {
  return { ...state, players: state.players.map((p) => ({ ...p, inventory: items })) };
}

function must(result: ReturnType<typeof applyCommand>) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("doors and movement", () => {
  it("parses into a closed door entity on a door tile", () => {
    const state = corridor("+");
    expect(state.barriers).toEqual([
      { id: "b1", kind: "door", position: { x: 3, y: 1 }, state: "closed" },
    ]);
    expect(state.map.tiles[1]?.[3]?.type).toBe("door");
  });

  it("a closed door blocks movement and pathfinding; an open one does not", () => {
    const closed = corridor("+");
    expect(validateMove(closed, closed.players[0]!, { x: 3, y: 1 })).toEqual({
      ok: false,
      reason: "DESTINATION_BLOCKED",
    });
    expect(validateMove(closed, closed.players[0]!, { x: 4, y: 1 })).toEqual({
      ok: false,
      reason: "DESTINATION_UNREACHABLE",
    });
    expect(legalMoveDestinations(closed, P1)).toEqual([{ x: 2, y: 1 }]);

    const open = corridor("O");
    expect(validateMove(open, open.players[0]!, { x: 4, y: 1 })).toMatchObject({
      ok: true,
      cost: 3,
    });
    expect(legalMoveDestinations(open, P1)).toHaveLength(4);
  });

  it("opening costs action points, needs reach, and unblocks the way at once", () => {
    const far = corridor("+");
    expect(applyCommand(far, { type: "open_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "BARRIER_OUT_OF_REACH",
    });
    const near = playerAt(far, 2, 1);
    const opened = must(applyCommand(near, { type: "open_door", playerId: P1, barrierId: B1 }));
    expect(opened.events).toEqual([
      {
        type: "door_opened",
        playerId: P1,
        barrierId: B1,
        position: { x: 3, y: 1 },
        usedKey: false,
        actionPointsSpent: 1,
      },
    ]);
    expect(opened.state.barriers[0]?.state).toBe("open");
    expect(opened.state.players[0]?.actionPoints).toBe(3);
    expect(applyCommand(opened.state, { type: "open_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "DOOR_ALREADY_OPEN",
    });
    const through = must(
      applyCommand(opened.state, { type: "move", playerId: P1, to: { x: 5, y: 1 } }),
    );
    expect(through.state.players[0]?.position).toEqual({ x: 5, y: 1 });
  });

  it("closing needs an open, unobstructed door", () => {
    const open = playerAt(corridor("O"), 2, 1);
    const closed = must(applyCommand(open, { type: "close_door", playerId: P1, barrierId: B1 }));
    expect(closed.events).toEqual([
      {
        type: "door_closed",
        playerId: P1,
        barrierId: B1,
        position: { x: 3, y: 1 },
        actionPointsSpent: 1,
      },
    ]);
    expect(closed.state.barriers[0]?.state).toBe("closed");
    expect(applyCommand(closed.state, { type: "close_door", playerId: P1, barrierId: B1 })).toEqual(
      { ok: false, reason: "DOOR_ALREADY_CLOSED" },
    );
    const inDoorway = playerAt(corridor("O"), 3, 1);
    expect(applyCommand(inDoorway, { type: "close_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "DOOR_OBSTRUCTED",
    });
  });

  it("rejects unknown barriers and doors too expensive to work", () => {
    const state = playerAt(corridor("+"), 2, 1);
    expect(
      applyCommand(state, { type: "open_door", playerId: P1, barrierId: barrierId("nope") }),
    ).toEqual({ ok: false, reason: "BARRIER_NOT_FOUND" });
    const broke = { ...state, players: state.players.map((p) => ({ ...p, actionPoints: 0 })) };
    expect(applyCommand(broke, { type: "open_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "INSUFFICIENT_ACTION_POINTS",
    });
  });
});

describe("locked doors, keys, and forced entry", () => {
  it("refuses ordinary opening, accepts a key and spends it", () => {
    const locked = playerAt(corridor("K"), 2, 1);
    expect(applyCommand(locked, { type: "open_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "DOOR_LOCKED",
    });
    const withKey = carrying(locked, "bandage", "key");
    const opened = must(applyCommand(withKey, { type: "open_door", playerId: P1, barrierId: B1 }));
    expect(opened.events[0]).toMatchObject({ type: "door_opened", usedKey: true });
    expect(opened.state.barriers[0]?.state).toBe("open");
    expect(opened.state.players[0]?.inventory).toEqual(["bandage"]);
  });

  it("a key cannot be used on its own", () => {
    const state = carrying(corridor("K"), "key");
    expect(applyCommand(state, { type: "use_item", playerId: P1, itemType: "key" })).toEqual({
      ok: false,
      reason: "ITEM_NOT_USABLE",
    });
  });

  it("forcing breaks the door for good and makes a noise through the noise system", () => {
    const locked = playerAt(corridor("K"), 2, 1);
    const forced = must(applyCommand(locked, { type: "force_entry", playerId: P1, barrierId: B1 }));
    expect(forced.events).toEqual([
      {
        type: "barrier_forced",
        playerId: P1,
        barrierId: B1,
        kind: "door",
        position: { x: 3, y: 1 },
        actionPointsSpent: 2,
      },
      {
        type: "noise_made",
        noiseId: "n1",
        position: { x: 3, y: 1 },
        intensity: 6,
        sourceType: "forced_entry",
      },
    ]);
    expect(forced.state.barriers[0]?.state).toBe("broken");
    expect(forced.state.players[0]?.actionPoints).toBe(2);
    expect(forced.state.noises).toHaveLength(1);
    // Broken is permanent: it cannot be closed, opened, or forced again.
    for (const type of ["close_door", "open_door"] as const) {
      expect(applyCommand(forced.state, { type, playerId: P1, barrierId: B1 })).toEqual({
        ok: false,
        reason: "DOOR_BROKEN",
      });
    }
    expect(
      applyCommand(forced.state, { type: "force_entry", playerId: P1, barrierId: B1 }),
    ).toEqual({ ok: false, reason: "BARRIER_NOT_FORCEABLE" });
    // Two action points remain: enough to step through the wreckage.
    expect(validateMove(forced.state, forced.state.players[0]!, { x: 4, y: 1 }).ok).toBe(true);
  });

  it("a closed door is opened, not forced", () => {
    const closed = playerAt(corridor("+"), 2, 1);
    expect(applyCommand(closed, { type: "force_entry", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "BARRIER_NOT_FORCEABLE",
    });
  });

  it("lists what the survivor can do to nearby barriers", () => {
    const closed = playerAt(corridor("+"), 2, 1);
    expect(barrierOptions(closed, closed.players[0]!)).toMatchObject({
      open: [{ id: B1 }],
      close: [],
      force: [],
    });
    const locked = playerAt(corridor("K"), 2, 1);
    expect(barrierOptions(locked, locked.players[0]!)).toMatchObject({
      open: [],
      close: [],
      force: [{ id: B1 }],
    });
    expect(
      barrierOptions(carrying(locked, "key"), carrying(locked, "key").players[0]!),
    ).toMatchObject({
      open: [{ id: B1 }],
      force: [{ id: B1 }],
    });
  });
});

describe("windows", () => {
  it("block movement but not sight, and can only be forced", () => {
    const state = playerAt(corridor("W"), 2, 1);
    expect(state.barriers[0]).toEqual({
      id: "b1",
      kind: "window",
      position: { x: 3, y: 1 },
      state: "closed",
    });
    expect(validateMove(state, state.players[0]!, { x: 4, y: 1 })).toEqual({
      ok: false,
      reason: "DESTINATION_UNREACHABLE",
    });
    expect(hasLineOfSight(state, { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(true);
    expect(applyCommand(state, { type: "open_door", playerId: P1, barrierId: B1 })).toEqual({
      ok: false,
      reason: "NOT_A_DOOR",
    });
    const forced = must(applyCommand(state, { type: "force_entry", playerId: P1, barrierId: B1 }));
    expect(forced.events[0]).toMatchObject({ type: "barrier_forced", kind: "window" });
    expect(forced.state.barriers[0]?.state).toBe("broken");
    expect(validateMove(forced.state, forced.state.players[0]!, { x: 4, y: 1 }).ok).toBe(true);
  });
});

describe("doors and sight", () => {
  const withZombie = (door: "+" | "O" | "W") =>
    makeTestState({
      players: [P1],
      layout: parseAsciiMap(["#######", `#S.${door}.Z#`, "#######"]),
    });

  it("a closed door blocks line of sight; open doors and windows do not", () => {
    expect(hasLineOfSight(withZombie("+"), { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(false);
    expect(hasLineOfSight(withZombie("O"), { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(true);
    expect(hasLineOfSight(withZombie("W"), { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(true);
  });

  it("shooting follows the same rule", () => {
    const closed = withZombie("+");
    expect(validateFire(closed, closed.players[0]!, Z1)).toEqual({
      ok: false,
      reason: "NO_LINE_OF_SIGHT",
    });
    const window = withZombie("W");
    expect(validateFire(window, window.players[0]!, Z1).ok).toBe(true);
  });

  it("zombies see through windows but cannot pass them, and cannot open doors", () => {
    const window = withZombie("W");
    expect(decideZombieAction(window, window.zombies[0]!)).toEqual({
      kind: "wait",
      investigating: undefined,
    });
    const closed = withZombie("+");
    const noisy = makeNoise(closed, { x: 1, y: 1 }, 8, "gunfire").state;
    // Heard, but nothing around the spot can be reached through the closed door.
    expect(decideZombieAction(noisy, noisy.zombies[0]!)).toEqual({
      kind: "wait",
      investigating: undefined,
    });
    const open = withZombie("O");
    expect(decideZombieAction(open, open.zombies[0]!)).toMatchObject({
      kind: "step",
      reason: "pursue",
      to: { x: 4, y: 1 },
    });
  });

  it("a survivor can shut a zombie out by closing the door behind them", () => {
    const open = playerAt(withZombie("O"), 2, 1);
    const closed = must(applyCommand(open, { type: "close_door", playerId: P1, barrierId: B1 }));
    const after = must(applyCommand(closed.state, { type: "end_turn", playerId: P1 }));
    expect(after.state.zombies[0]?.position).toEqual({ x: 5, y: 1 });
    expect(after.events.some((e) => e.type === "zombie_moved")).toBe(false);
  });
});
