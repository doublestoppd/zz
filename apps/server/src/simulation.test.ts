import { describe, expect, it } from "vitest";
import {
  barrierOptions,
  createInitialState,
  currentStep,
  findShortestPath,
  legalFireTargets,
  legalMeleeTargets,
  legalMoveDestinations,
  matchId,
  passabilityFor,
  playerId,
  positionsEqual,
  stepZone,
  validateReload,
  chebyshevDistance,
  type Command,
  type GameState,
  type PlayerState,
  type Position,
} from "@zombie/game-core";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";

const MAX_ROUNDS = 40;

/**
 * A plain, greedy survivor: shoot what is close, reload when empty, otherwise walk toward
 * the current objective (opening or forcing doors in the way), then end the turn. Not
 * clever, so its results are a floor: humans should do better than this.
 */
function decide(state: GameState, me: PlayerState): Command {
  const near = legalFireTargets(state, me).filter(
    (z) => chebyshevDistance(z.position, me.position) <= 2,
  );
  if (near.length > 0) return { type: "fire_weapon", playerId: me.id, targetId: near[0]!.id };
  const adjacent = legalMeleeTargets(state, me);
  if (adjacent.length > 0 && me.weapon.loadedAmmo === 0) {
    return { type: "melee_attack", playerId: me.id, targetId: adjacent[0]!.id };
  }
  if (me.weapon.loadedAmmo === 0 && validateReload(state, me).ok) {
    return { type: "reload", playerId: me.id };
  }
  const goal = goalFor(state, me);
  if (goal !== undefined) {
    const passable = passabilityFor(state, { kind: "survivor", id: me.id });
    const path = findShortestPath(state.map, me.position, goal, 500, passable);
    if (path !== undefined) {
      const legal = legalMoveDestinations(state, me.id);
      let dest: Position | undefined;
      for (const step of path) if (legal.some((l) => positionsEqual(l, step))) dest = step;
      if (dest !== undefined) return { type: "move", playerId: me.id, to: dest };
    } else {
      const doors = barrierOptions(state, me);
      const door = doors.open[0] ?? doors.force[0];
      if (door !== undefined) {
        return {
          type: doors.open[0] !== undefined ? "open_door" : "force_entry",
          playerId: me.id,
          barrierId: door.id,
        };
      }
      // Walk to whichever reachable tile is closest to the goal.
      const legal = legalMoveDestinations(state, me.id);
      const best = legal.reduce<Position | undefined>(
        (b, p) =>
          b === undefined || chebyshevDistance(p, goal) < chebyshevDistance(b, goal) ? p : b,
        undefined,
      );
      if (
        best !== undefined &&
        chebyshevDistance(best, goal) < chebyshevDistance(me.position, goal)
      ) {
        return { type: "move", playerId: me.id, to: best };
      }
    }
  }
  return { type: "end_turn", playerId: me.id };
}

function goalFor(state: GameState, me: PlayerState): Position | undefined {
  const step = currentStep(state.objective);
  if (step === undefined) return undefined;
  if (step.kind === "acquire_item") {
    const item = state.items.find((i) => i.type === step.itemType);
    return item?.position;
  }
  const zone = stepZone(step);
  if (zone.some((p) => positionsEqual(p, me.position))) return undefined;
  const free = zone.filter(
    (p) => !state.players.some((o) => o.id !== me.id && positionsEqual(o.position, p)),
  );
  // Fill the back of the zone first so late arrivals are not walled out by teammates.
  const passable = passabilityFor(state, { kind: "survivor", id: me.id });
  let best: { p: Position; d: number } | undefined;
  for (const p of free) {
    const path = findShortestPath(state.map, me.position, p, 500, passable);
    const d = path === undefined ? -1 : path.length;
    if (best === undefined || d > best.d) best = { p, d };
  }
  return best?.p;
}

interface Result {
  readonly players: number;
  readonly seed: number;
  readonly outcome: "victory" | "defeat" | "timeout";
  readonly rounds: number;
  readonly downs: number;
  readonly threat: number;
}

function simulate(players: number, seed: number): Result {
  const layout = generateCity({
    ...DEFAULT_CITY_OPTIONS,
    seed,
    survivorSpawns: players,
    zombieSpawns: 3 + players,
    lootSpawns: 2 + players,
  });
  let state = createInitialState({
    matchId: matchId(`sim-${players}-${seed}`),
    seed,
    rules: DEFAULT_GAME_RULES,
    survivor: DEFAULT_SURVIVOR,
    scenario: SCENARIOS.extraction,
    lootTable: LOOT_TABLE,
    zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
    layout,
    players: Array.from({ length: players }, (_, i) => ({
      id: playerId(`p${i + 1}`),
      name: `p${i + 1}`,
    })),
  });
  let downs = 0;
  let guard = 0;
  while (state.phase.kind === "player_turn" && state.round <= MAX_ROUNDS && guard < 5000) {
    guard += 1;
    const active = state.phase.activePlayerId;
    const me = state.players.find((p) => p.id === active);
    if (me === undefined) break;
    const command = decide(state, me);
    const result = applyOrEnd(state, command, me.id);
    downs += result.events.filter((e) => e.type === "player_downed").length;
    state = result.state;
  }
  const outcome = state.phase.kind === "finished" ? state.phase.outcome : "timeout";
  return { players, seed, outcome, rounds: state.round, downs, threat: state.threat };
}

function applyOrEnd(state: GameState, command: Command, me: PlayerState["id"]) {
  const applied = applyCommandSafe(state, command);
  if (applied !== undefined) return applied;
  const ended = applyCommandSafe(state, { type: "end_turn", playerId: me });
  if (ended === undefined) throw new Error("end_turn rejected");
  return ended;
}

import { applyCommand } from "@zombie/game-core";
function applyCommandSafe(state: GameState, command: Command) {
  const r = applyCommand(state, command);
  return r.ok ? r : undefined;
}

describe("playtest matrix (greedy bots, extraction, default balance)", () => {
  it("runs 1 to 4 players over several seeds and every match ends", () => {
    const results: Result[] = [];
    for (let players = 1; players <= 4; players += 1) {
      for (let seed = 1; seed <= 4; seed += 1) results.push(simulate(players, seed));
    }
    const lines = results.map(
      (r) => `| ${r.players} | ${r.seed} | ${r.outcome} | ${r.rounds} | ${r.downs} | ${r.threat} |`,
    );
    console.log(
      [
        "| players | seed | outcome | rounds | downs | threat |",
        "| --- | --- | --- | --- | --- | --- |",
        ...lines,
      ].join("\n"),
    );
    expect(results.every((r) => r.outcome !== "timeout")).toBe(true);
    expect(results.some((r) => r.outcome === "victory")).toBe(true);
  });
});
