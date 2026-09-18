import { describe, expect, it } from "vitest";
import {
  createInitialState,
  matchId,
  playerId,
  type Command,
  type GameState,
  type PlayerState,
} from "@zombie/game-core";
import { decide } from "./soak/botPolicy.js";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";

const MAX_ROUNDS = 40;

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

import { applyCommand, assertInvariants } from "@zombie/game-core";
function applyCommandSafe(state: GameState, command: Command) {
  const r = applyCommand(state, command);
  if (r.ok) assertInvariants(r.state);
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
