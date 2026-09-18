import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import type { Command } from "../commands/types.js";
import { itemId, playerId, zombieId } from "../ids.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { makeTestState, P1, P2 } from "../testing/makeTestState.js";
import { assertInvariants, checkInvariants } from "./invariants.js";
import type { GameState } from "./types.js";

const LAYOUT = parseAsciiMap([
  "##########",
  "#S..#..Z.#",
  "#S.L#....#",
  "#S....Z.E#",
  "##########",
]);

function base(): GameState {
  return makeTestState({ players: [P1, P2], layout: LAYOUT });
}

function codes(state: GameState, level: "critical" | "full" = "full"): string[] {
  return checkInvariants(state, level).map((v) => v.code);
}

describe("checkInvariants", () => {
  it("passes a fresh state and the states after ordinary commands", () => {
    let state = base();
    expect(checkInvariants(state)).toEqual([]);
    const commands: Command[] = [
      { type: "move", playerId: P1, to: { x: 2, y: 1 } },
      { type: "end_turn", playerId: P1 },
      { type: "end_turn", playerId: P2 },
      { type: "set_player_presence", playerId: P2, present: false },
    ];
    for (const command of commands) {
      const result = applyCommand(state, command);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
      expect(checkInvariants(state)).toEqual([]);
    }
    expect(() => {
      assertInvariants(state);
    }).not.toThrow();
  });

  it("reports two solid entities on one tile and entities off the board", () => {
    const state = base();
    const [p1, p2] = state.players as [GameState["players"][number], GameState["players"][number]];
    const stacked: GameState = { ...state, players: [p1, { ...p2, position: p1.position }] };
    expect(codes(stacked, "critical")).toEqual(["OCCUPANCY"]);
    const zombieOnPlayer: GameState = {
      ...state,
      zombies: state.zombies.map((z, i) => (i === 0 ? { ...z, position: p1.position } : z)),
    };
    expect(codes(zombieOnPlayer, "critical")).toEqual(["OCCUPANCY"]);
    const outside: GameState = {
      ...state,
      players: [{ ...p1, position: { x: 99, y: 1 } }, p2],
    };
    expect(codes(outside, "critical")).toEqual(["OUT_OF_BOUNDS"]);
    const inWall: GameState = { ...state, players: [{ ...p1, position: { x: 0, y: 0 } }, p2] };
    expect(codes(inWall, "critical")).toEqual(["NOT_WALKABLE"]);
  });

  it("reports action points, ammunition, and health outside their bounds", () => {
    const state = base();
    const [p1, p2] = state.players as [GameState["players"][number], GameState["players"][number]];
    const negativeAp: GameState = { ...state, players: [{ ...p1, actionPoints: -1 }, p2] };
    expect(codes(negativeAp, "critical")).toEqual(["ACTION_POINTS"]);
    const negativeAmmo: GameState = {
      ...state,
      players: [{ ...p1, weapon: { ...p1.weapon, loadedAmmo: -1 } }, p2],
    };
    expect(codes(negativeAmmo, "critical")).toEqual(["AMMO"]);
    const overfull: GameState = {
      ...state,
      players: [{ ...p1, weapon: { ...p1.weapon, loadedAmmo: 999 } }, p2],
    };
    expect(codes(overfull, "critical")).toEqual([]); // magazine size is a reference check
    expect(codes(overfull, "full")).toEqual(["AMMO"]);
    const overHealed: GameState = { ...state, players: [{ ...p1, health: p1.maxHealth + 1 }, p2] };
    expect(codes(overHealed, "critical")).toEqual(["HEALTH"]);
    const standingAtZero: GameState = { ...state, players: [{ ...p1, health: 0 }, p2] };
    expect(codes(standingAtZero, "critical")).toEqual(["STATUS"]);
    const deadZombie: GameState = {
      ...state,
      zombies: state.zombies.map((z, i) => (i === 0 ? { ...z, health: 0 } : z)),
    };
    expect(codes(deadZombie, "critical")).toEqual(["HEALTH"]);
  });

  it("requires an eligible active player whenever anyone could act", () => {
    const state = base();
    const [p1, p2] = state.players as [GameState["players"][number], GameState["players"][number]];
    const ghost: GameState = {
      ...state,
      phase: { kind: "player_turn", activePlayerId: playerId("nobody") },
    };
    expect(codes(ghost, "critical")).toEqual(["ACTIVE_PLAYER"]);
    const downHoldsTurn: GameState = {
      ...state,
      players: [{ ...p1, health: 0, status: "down" }, p2],
    };
    expect(codes(downHoldsTurn, "critical")).toEqual(["ACTIVE_PLAYER"]);
    const absentHoldsTurn: GameState = { ...state, players: [{ ...p1, present: false }, p2] };
    expect(codes(absentHoldsTurn, "critical")).toEqual(["ACTIVE_PLAYER"]);
    // Nobody can act: the turn may rest with an absent player (the match is paused).
    const paused: GameState = {
      ...state,
      players: [
        { ...p1, present: false },
        { ...p2, present: false },
      ],
    };
    expect(codes(paused, "critical")).toEqual([]);
  });

  it("reports an inconsistent turn order, phase, and objective", () => {
    const state = base();
    const shortOrder: GameState = { ...state, turnOrder: [P1] };
    expect(codes(shortOrder, "critical")).toEqual(["TURN_ORDER"]);
    const stranger: GameState = { ...state, turnOrder: [P1, playerId("x")] };
    expect(codes(stranger, "critical")).toEqual(["TURN_ORDER"]);
    const wonButPlaying: GameState = {
      ...state,
      objective: { ...state.objective, status: "complete", current: state.objective.steps.length },
    };
    expect(codes(wonButPlaying, "critical")).toEqual(["PHASE"]);
    const finishedWrong: GameState = { ...state, phase: { kind: "finished", outcome: "victory" } };
    expect(codes(finishedWrong, "critical")).toEqual(["PHASE"]);
    const defeatAllDown: GameState = {
      ...state,
      phase: { kind: "finished", outcome: "defeat" },
      players: state.players.map((p) => ({ ...p, health: 0, status: "down" as const })),
    };
    expect(codes(defeatAllDown, "critical")).toEqual([]);
    const pastTheEnd: GameState = {
      ...state,
      objective: { ...state.objective, current: state.objective.steps.length + 1 },
    };
    expect(codes(pastTheEnd)).toContain("OBJECTIVE");
    const emptyZone: GameState = {
      ...state,
      objective: {
        ...state.objective,
        steps: state.objective.steps.map((s) =>
          s.kind === "reach_location" ? { ...s, zone: [] } : s,
        ),
      },
    };
    expect(codes(emptyZone)).toEqual(["OBJECTIVE"]);
  });

  it("reports bad references and duplicate ids at the full level only", () => {
    const state = base();
    const [p1, p2] = state.players as [GameState["players"][number], GameState["players"][number]];
    const unknownItem: GameState = {
      ...state,
      players: [{ ...p1, inventory: ["laser" as never] }, p2],
    };
    expect(codes(unknownItem, "critical")).toEqual([]);
    expect(codes(unknownItem)).toEqual(["INVENTORY"]);
    const overloaded: GameState = {
      ...state,
      players: [
        { ...p1, inventory: Array<"bandage">(p1.inventoryCapacity + 1).fill("bandage") },
        p2,
      ],
    };
    expect(codes(overloaded)).toEqual(["INVENTORY"]);
    const meleeInGunSlot: GameState = {
      ...state,
      players: [{ ...p1, weapon: { type: "bat", loadedAmmo: 0 } }, p2],
    };
    expect(codes(meleeInGunSlot)).toEqual(["WEAPON"]);
    const twins: GameState = {
      ...state,
      zombies: [...state.zombies, { ...state.zombies[0]!, position: { x: 4, y: 3 } }],
    };
    expect(codes(twins)).toEqual(["DUPLICATE_ID"]);
    const dupItem: GameState = {
      ...state,
      items: [
        ...state.items,
        { id: state.items[0]!.id, type: "bandage", position: { x: 2, y: 3 } },
      ],
    };
    expect(codes(dupItem)).toEqual(["DUPLICATE_ID"]);
    const strayZombieId: GameState = {
      ...state,
      zombies: state.zombies.map((z, i) => (i === 1 ? { ...z, id: zombieId("z-dup") } : z)),
      items: state.items.map((i) => ({ ...i, id: itemId("i-1") })),
    };
    expect(codes(strayZombieId)).toEqual([]);
  });

  it("assertInvariants lists every violation", () => {
    const state = base();
    const [p1, p2] = state.players as [GameState["players"][number], GameState["players"][number]];
    const broken: GameState = {
      ...state,
      players: [{ ...p1, actionPoints: -3, position: p2.position }, p2],
    };
    expect(() => {
      assertInvariants(broken);
    }).toThrow(/OCCUPANCY.*\n.*ACTION_POINTS/s);
  });
});

describe("terminal matches", () => {
  it("reject every gameplay command once finished, with no state change", () => {
    const state = base();
    const finished: GameState = { ...state, phase: { kind: "finished", outcome: "defeat" } };
    const zombie = state.zombies[0]?.id ?? zombieId("z");
    const all: Command[] = [
      { type: "move", playerId: P1, to: { x: 2, y: 1 } },
      { type: "fire_weapon", playerId: P1, targetId: zombie },
      { type: "melee_attack", playerId: P1, targetId: zombie },
      { type: "reload", playerId: P1 },
      { type: "pick_up", playerId: P1, itemId: itemId("i") },
      { type: "use_item", playerId: P1, itemType: "bandage" },
      { type: "search", playerId: P1, containerId: "c" as never },
      { type: "open_door", playerId: P1, barrierId: "b" as never },
      { type: "close_door", playerId: P1, barrierId: "b" as never },
      { type: "force_entry", playerId: P1, barrierId: "b" as never },
      { type: "end_turn", playerId: P1 },
    ];
    for (const command of all) {
      expect(applyCommand(finished, command), command.type).toEqual({
        ok: false,
        reason: "MATCH_FINISHED",
      });
    }
    // Presence still changes (a player may leave or return to read the result) but the
    // phase stays finished and the invariants hold.
    const presence = applyCommand(finished, {
      type: "set_player_presence",
      playerId: P1,
      present: false,
    });
    expect(presence.ok).toBe(true);
    if (presence.ok) {
      expect(presence.state.phase).toEqual({ kind: "finished", outcome: "defeat" });
      expect(checkInvariants(presence.state)).toEqual([]);
    }
  });
});
