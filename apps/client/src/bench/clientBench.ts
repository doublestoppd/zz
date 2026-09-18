import {
  createInitialState,
  matchId,
  parseAsciiMap,
  playerId,
  zombieId,
  type GameEvent,
  type GameState,
  type ZombieState,
} from "@zombie/game-core";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import { decodeServerMessage, encodeMessage, type UpdateMessage } from "@zombie/protocol";
import { planAnimations } from "../render/animationPlan.js";
import { ClientStore } from "../state/ClientStore.js";

/**
 * The client's pure per-update work, measured in Node without Phaser: decoding the wire
 * text, applying it to the store, and planning animations for a busy zombie phase. The
 * board is an open 40x24 room with 120 zombies, the client-side worst case (every zombie
 * visible, so nothing is redacted). Rendering itself is measured in a browser by
 * `apps/client/bench/renderBench.mts`.
 */
const WIDTH = 40;
const HEIGHT = 24;
const ZOMBIES = 120;

function heavyState(): GameState {
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    let row = "";
    for (let x = 0; x < WIDTH; x += 1) {
      const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      row += edge ? "#" : x === 1 && y >= 1 && y <= 4 ? "S" : x === WIDTH - 2 && y <= 2 ? "E" : ".";
    }
    rows.push(row);
  }
  const layout = parseAsciiMap(rows);
  const base = createInitialState({
    matchId: matchId("client-bench"),
    seed: 1,
    rules: DEFAULT_GAME_RULES,
    survivor: DEFAULT_SURVIVOR,
    scenario: SCENARIOS.extraction,
    lootTable: LOOT_TABLE,
    zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
    layout,
    players: [1, 2, 3, 4].map((i) => ({ id: playerId(`p${i}`), name: `p${i}` })),
  });
  const zombies: ZombieState[] = [];
  for (let i = 0; i < ZOMBIES; i += 1) {
    zombies.push({
      id: zombieId(`z${i + 1}`),
      type: i % 3 === 0 ? "runner" : i % 7 === 0 ? "brute" : "walker",
      position: { x: 5 + (i % 30), y: 3 + Math.floor(i / 30) * 4 },
      health: 3,
    });
  }
  return { ...base, zombies, zombieCounter: ZOMBIES };
}

interface Row {
  readonly name: string;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly note: string;
}

function measure(name: string, work: () => unknown, note: string): Row {
  for (let i = 0; i < 3; i += 1) work();
  const samples: number[] = [];
  const started = performance.now();
  while (samples.length < 50 && performance.now() - started < 2000) {
    const t0 = performance.now();
    work();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0;
  return { name, medianMs: at(0.5), p95Ms: at(0.95), note };
}

export function runClientBenchmarks(): Row[] {
  const before = heavyState();
  // A zombie phase in which every zombie steps once and a few attack: the busiest update.
  const events: GameEvent[] = before.zombies.map((z) => ({
    type: "zombie_moved",
    zombieId: z.id,
    from: z.position,
    to: { x: z.position.x - 1, y: z.position.y },
  }));
  const after: GameState = {
    ...before,
    zombies: before.zombies.map((z) => ({
      ...z,
      position: { x: z.position.x - 1, y: z.position.y },
    })),
  };
  const { map: _map, ...wireState } = after;
  const update: UpdateMessage = { t: "update", revision: 2, state: wireState, events };
  const wire = encodeMessage(update);
  const mapWire = encodeMessage({ t: "map", map: before.map });
  const rows: Row[] = [];
  rows.push(
    measure(
      "decodeServerMessage update",
      () => decodeServerMessage(wire),
      `${wire.length} chars, ${events.length} events`,
    ),
    measure(
      "decodeServerMessage map",
      () => decodeServerMessage(mapWire),
      `${mapWire.length} chars, ${WIDTH}x${HEIGHT}`,
    ),
  );
  const store = new ClientStore();
  store.applyServerMessage({ t: "map", map: before.map });
  rows.push(
    measure(
      "ClientStore.applyServerMessage update",
      () => {
        store.applyServerMessage(update);
      },
      `${ZOMBIES} zombies`,
    ),
    measure(
      "planAnimations zombie phase",
      () => planAnimations(events, before, after, playerId("p1")),
      `${events.length} events`,
    ),
  );
  return rows;
}

export function formatClientTable(rows: readonly Row[]): string {
  const f = (n: number) => (n < 10 ? n.toFixed(3) : n.toFixed(2));
  return [
    "| case | median ms | p95 ms | note |",
    "| --- | ---: | ---: | --- |",
    ...rows.map((r) => `| ${r.name} | ${f(r.medianMs)} | ${f(r.p95Ms)} | ${r.note} |`),
  ].join("\n");
}
