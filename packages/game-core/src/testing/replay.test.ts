import { describe, expect, it } from "vitest";
import { applyCommand } from "../commands/applyCommand.js";
import type { Command } from "../commands/types.js";
import { parseAsciiMap } from "../map/asciiMap.js";
import { createRng } from "../random/rng.js";
import { legalFireTargets, legalMeleeTargets, legalMoveDestinations } from "../rules/index.js";
import { checkInvariants } from "../state/invariants.js";
import type { GameState } from "../state/types.js";
import { isEligibleToAct } from "../turn/turnOrder.js";
import { makeTestState, P1, P2, P3 } from "./makeTestState.js";

/** A small board with walls, zombies, loot, and an extraction zone so every command kind occurs. */
const LAYOUT = parseAsciiMap([
  "############",
  "#S...#..Z..#",
  "#S.L.#...L.#",
  "#S...#..Z.E#",
  "#....#....E#",
  "#..Z.......#",
  "############",
]);

/** Picks a random legal command for the active player, with occasional presence changes. */
function randomCommand(state: GameState, rng: ReturnType<typeof createRng>): Command | undefined {
  if (state.phase.kind !== "player_turn") return undefined;
  const activeId = state.phase.activePlayerId;
  const me = state.players.find((p) => p.id === activeId);
  if (me === undefined) return undefined;
  const options: Command[] = [{ type: "end_turn", playerId: me.id }];
  const moves = legalMoveDestinations(state, me.id);
  if (moves.length > 0) options.push({ type: "move", playerId: me.id, to: rng.pick(moves) });
  const targets = legalFireTargets(state, me);
  if (targets.length > 0)
    options.push({ type: "fire_weapon", playerId: me.id, targetId: rng.pick(targets).id });
  const adjacent = legalMeleeTargets(state, me);
  if (adjacent.length > 0)
    options.push({ type: "melee_attack", playerId: me.id, targetId: rng.pick(adjacent).id });
  if (me.weapon.loadedAmmo < 6 && me.reserveAmmo.pistol_rounds > 0)
    options.push({ type: "reload", playerId: me.id });
  const item = state.items.find(
    (i) => i.position.x === me.position.x && i.position.y === me.position.y,
  );
  if (item !== undefined) options.push({ type: "pick_up", playerId: me.id, itemId: item.id });
  const carried = me.inventory[0];
  if (carried !== undefined) options.push({ type: "use_item", playerId: me.id, itemType: carried });
  if (rng.next() < 0.08) {
    options.push({
      type: "set_player_presence",
      playerId: rng.pick(state.players).id,
      present: rng.next() < 0.5,
    });
  }
  return rng.pick(options);
}

interface Run {
  readonly commands: Command[];
  readonly snapshots: (GameState | undefined)[];
}

function play(seed: number, steps: number): Run {
  let state = makeTestState({ players: [P1, P2, P3], layout: LAYOUT, seed, zombieDamage: 3 });
  const rng = createRng(seed * 31 + 7);
  const commands: Command[] = [];
  const snapshots: (GameState | undefined)[] = [];
  for (let i = 0; i < steps; i += 1) {
    const command = randomCommand(state, rng);
    if (command === undefined) break;
    commands.push(command);
    const result = applyCommand(state, command);
    if (result.ok) state = result.state;
    snapshots.push(result.ok ? state : undefined);
    if (state.phase.kind === "finished") break;
  }
  return { commands, snapshots };
}

describe("random play replays exactly and keeps the turn invariants", () => {
  it.each([1, 2, 3, 4])("seed %i", (seed) => {
    const first = play(seed, 160);
    const second = play(seed, 160);
    expect(second).toEqual(first);

    // Every accepted state is waiting on someone who can act, or finished, and every
    // state invariant holds after every accepted command.
    for (const snapshot of first.snapshots) {
      if (snapshot === undefined) continue;
      expect(checkInvariants(snapshot)).toEqual([]);
      if (snapshot.phase.kind === "player_turn") {
        const activeId = snapshot.phase.activePlayerId;
        const active = snapshot.players.find((p) => p.id === activeId);
        expect(active?.status).toBe("active");
        // Either the active player can act, or nobody at all can (the match is paused).
        expect(isEligibleToAct(active!) || snapshot.players.every((p) => !isEligibleToAct(p))).toBe(
          true,
        );
      } else {
        expect(snapshot.phase.kind).toBe("finished");
      }
    }

    // Resume from a JSON round-tripped mid-match snapshot and get the same states.
    const midpoint = Math.floor(first.snapshots.length / 2);
    let resumeIndex = -1;
    for (let i = midpoint - 1; i >= 0; i -= 1) {
      if (first.snapshots[i] !== undefined) {
        resumeIndex = i;
        break;
      }
    }
    if (resumeIndex === -1) return;
    let state = JSON.parse(JSON.stringify(first.snapshots[resumeIndex])) as GameState;
    for (let i = resumeIndex + 1; i < first.commands.length; i += 1) {
      const result = applyCommand(state, first.commands[i]!);
      if (result.ok) state = result.state;
      expect(result.ok ? state : undefined).toEqual(first.snapshots[i]);
    }
  });
});
