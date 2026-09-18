import {
  applyCommand,
  createInitialState,
  createRng,
  matchId,
  noiseId,
  playerId,
  positionKey,
  tileAt,
  zombieId,
  type GameState,
  type NoiseEvent,
  type Position,
  type ZombieState,
  type ZombieType,
} from "@zombie/game-core";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import { DEFAULT_CITY_OPTIONS, generateCity, type CityOptions } from "@zombie/map-generation";
import { decide } from "../soak/botPolicy.js";

/**
 * Benchmark fixtures, all deterministic from fixed seeds so two runs measure the same
 * work. Sizes are chosen from the rules, not invented (docs/PERFORMANCE.md):
 *
 * - `typical`: four survivors on the default 26x18 city after twelve rounds of greedy
 *   play, so the board holds the reinforcements a real match has by then.
 * - `heavy`: the same board with the zombie population raised to `HEAVY_ZOMBIES`. Waves
 *   add at most two zombies a round at the top threat level (game-data/threat.ts), plus
 *   three per horde; 120 is what a sixty-round level-4 match would hold if nothing were
 *   ever killed, so it is the worst credible population, not a typical one.
 * - `large`: a city twice the default in each dimension (52x36, four times the tiles)
 *   with the heavy population. The server only generates the default size today; this
 *   bounds a future map-size option.
 * - `noisy`: heavy plus `NOISE_SOURCES` live noises spread over the board and a horde
 *   event pending, so every zombie has something to hear and evaluate.
 */
export const HEAVY_ZOMBIES = 120;
export const NOISE_SOURCES = 40;
export const LARGE_CITY: Omit<CityOptions, "seed"> = {
  ...DEFAULT_CITY_OPTIONS,
  width: DEFAULT_CITY_OPTIONS.width * 2,
  height: DEFAULT_CITY_OPTIONS.height * 2,
  zombieSpawns: 7,
  lootSpawns: 6,
};

export interface Fixture {
  readonly name: string;
  readonly state: GameState;
}

const PLAYERS = 4;

export function cityState(options: Omit<CityOptions, "seed">, seed: number): GameState {
  const layout = generateCity({
    ...options,
    seed,
    survivorSpawns: PLAYERS,
    zombieSpawns: 3 + PLAYERS,
    lootSpawns: 2 + PLAYERS,
  });
  return createInitialState({
    matchId: matchId(`bench-${seed}`),
    seed,
    rules: DEFAULT_GAME_RULES,
    survivor: DEFAULT_SURVIVOR,
    scenario: SCENARIOS.extraction,
    lootTable: LOOT_TABLE,
    zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
    layout,
    players: Array.from({ length: PLAYERS }, (_, i) => ({
      id: playerId(`p${i + 1}`),
      name: `p${i + 1}`,
    })),
  });
}

/** Plays the greedy bots until `round` begins (or the match ends), returning the state. */
export function playUntilRound(initial: GameState, round: number): GameState {
  let state = initial;
  for (let guard = 0; guard < 5000; guard += 1) {
    if (state.phase.kind !== "player_turn" || state.round >= round) break;
    const me = state.players.find(
      (p) => p.id === (state.phase as { activePlayerId: string }).activePlayerId,
    );
    if (me === undefined) break;
    const result = applyCommand(state, decide(state, me));
    if (result.ok) {
      state = result.state;
      continue;
    }
    const ended = applyCommand(state, { type: "end_turn", playerId: me.id });
    if (!ended.ok) break;
    state = ended.state;
  }
  return state;
}

/**
 * Raises the zombie population to `count` by placing walkers, runners, and brutes on free
 * walkable tiles chosen by a seeded shuffle, never next to a survivor (so the phase does
 * work rather than a hundred adjacent attacks). Ids continue the state's counter.
 */
export function withZombies(state: GameState, count: number, seed: number): GameState {
  const rng = createRng(seed);
  const taken = new Set<string>([
    ...state.players.map((p) => positionKey(p.position)),
    ...state.zombies.map((z) => positionKey(z.position)),
  ]);
  const nearPlayer = (p: Position) =>
    state.players.some(
      (s) => Math.abs(s.position.x - p.x) <= 1 && Math.abs(s.position.y - p.y) <= 1,
    );
  const free: Position[] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const p = { x, y };
      if (tileAt(state.map, p)?.walkable !== true) continue;
      if (taken.has(positionKey(p)) || nearPlayer(p)) continue;
      free.push(p);
    }
  }
  for (let i = free.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const a = free[i];
    const b = free[j];
    if (a !== undefined && b !== undefined) {
      free[i] = b;
      free[j] = a;
    }
  }
  const types: ZombieType[] = ["walker", "walker", "runner", "brute"];
  const zombies: ZombieState[] = [...state.zombies];
  let counter = state.zombieCounter;
  for (let i = zombies.length; i < count; i += 1) {
    const position = free[i - state.zombies.length];
    if (position === undefined) break;
    counter += 1;
    const type = types[i % types.length] ?? "walker";
    zombies.push({
      id: zombieId(`z${counter}`),
      type,
      position,
      health: state.rules.zombieDefinitions[type].maxHealth,
    });
  }
  return { ...state, zombies, zombieCounter: counter };
}

/** Adds `count` live noises of mixed intensity spread over walkable tiles. */
export function withNoises(state: GameState, count: number, seed: number): GameState {
  const rng = createRng(seed);
  const noises: NoiseEvent[] = [...state.noises];
  let counter = state.noiseCounter;
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    let position: Position;
    do {
      position = { x: rng.int(0, state.map.width - 1), y: rng.int(0, state.map.height - 1) };
    } while (tileAt(state.map, position)?.walkable !== true);
    noises.push({
      id: noiseId(`n${counter}`),
      position,
      intensity: rng.int(3, 10),
      remainingRounds: rng.int(1, 2),
      sourceType: "gunfire",
    });
  }
  return { ...state, noises, noiseCounter: counter, heat: state.heat + count * 5 };
}

/** The end-of-turn command from the active player, or undefined when the match is over. */
export function endTurnCommand(state: GameState) {
  if (state.phase.kind !== "player_turn") return undefined;
  return { type: "end_turn" as const, playerId: state.phase.activePlayerId };
}

export function buildFixtures(): Record<"typical" | "heavy" | "large" | "noisy", Fixture> {
  const typical = playUntilRound(cityState(DEFAULT_CITY_OPTIONS, 1), 12);
  const heavy = withZombies(typical, HEAVY_ZOMBIES, 11);
  const large = withZombies(playUntilRound(cityState(LARGE_CITY, 1), 12), HEAVY_ZOMBIES, 12);
  const noisy = withNoises(heavy, NOISE_SOURCES, 13);
  return {
    typical: { name: "typical", state: typical },
    heavy: { name: "heavy", state: heavy },
    large: { name: "large", state: large },
    noisy: { name: "noisy", state: noisy },
  };
}
