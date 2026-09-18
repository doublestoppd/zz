import { chromium } from "playwright-core";
import { WebSocketServer } from "ws";
import { createServer } from "vite";
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
import { decodeClientMessage, encodeMessage, PROTOCOL_VERSION } from "@zombie/protocol";

/**
 * `pnpm --filter @zombie/client bench:render`: the real client in headless Chromium against
 * a fake server that speaks the protocol and pushes synthetic updates, measuring what the
 * browser does per update: the synchronous handler (decode, store, HUD, board reconcile and
 * tween setup) and the frame times while the tweens play. Needs a Chromium binary in
 * `CHROMIUM_PATH` (or Playwright's own). Not part of CI; results go in docs/PERFORMANCE.md.
 */
const ZOMBIE_COUNTS = [10, 60, 120];
const UPDATES_PER_COUNT = 12;
const WIDTH = 40;
const HEIGHT = 24;

function boardState(zombies: number): GameState {
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    let row = "";
    for (let x = 0; x < WIDTH; x += 1) {
      const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      row += edge ? "#" : x === 1 && y >= 1 && y <= 4 ? "S" : x === WIDTH - 2 && y <= 2 ? "E" : ".";
    }
    rows.push(row);
  }
  const base = createInitialState({
    matchId: matchId("render-bench"),
    seed: 1,
    rules: DEFAULT_GAME_RULES,
    survivor: DEFAULT_SURVIVOR,
    scenario: SCENARIOS.extraction,
    lootTable: LOOT_TABLE,
    zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
    layout: parseAsciiMap(rows),
    players: [1, 2, 3, 4].map((i) => ({ id: playerId(`p${i}`), name: `p${i}` })),
  });
  const list: ZombieState[] = [];
  for (let i = 0; i < zombies; i += 1) {
    list.push({
      id: zombieId(`z${i + 1}`),
      type: i % 3 === 0 ? "runner" : i % 7 === 0 ? "brute" : "walker",
      position: { x: 6 + (i % 30), y: 3 + Math.floor(i / 30) * 4 },
      health: 3,
    });
  }
  return { ...base, zombies: list, zombieCounter: zombies };
}

/** Every zombie steps one tile left or right, alternating per update. */
function step(state: GameState, direction: 1 | -1): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const zombies = state.zombies.map((z) => {
    const to = { x: z.position.x + direction, y: z.position.y };
    events.push({ type: "zombie_moved", zombieId: z.id, from: z.position, to });
    return { ...z, position: to };
  });
  return { state: { ...state, zombies }, events };
}

const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

const wss = new WebSocketServer({ port: 0 });
const wsPort = (wss.address() as { port: number }).port;
// The client reads VITE_SERVER_URL at build time; the dev server is started here with it
// pointed at the fake server, so the real `main.ts` connects there unchanged.
/**
 * Runs in the page's own world before the app's scripts: wraps every WebSocket message
 * listener to time the synchronous handling of `update` messages, records frame intervals,
 * and publishes both as a DOM attribute so the harness can read them from any world.
 */
const INSTRUMENTATION = `
(() => {
  const handler = [];
  const frames = [];
  const publish = () => document.documentElement.setAttribute("data-bench", JSON.stringify({ handler, frames }));
  new MutationObserver(() => { handler.length = 0; frames.length = 0; publish(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-bench-reset"] });
  const proto = WebSocket.prototype;
  const original = proto.addEventListener;
  proto.addEventListener = function (type, listener, options) {
    const wrapped = type === "message" && typeof listener === "function"
      ? (ev) => {
          const isUpdate = typeof ev.data === "string" && ev.data.startsWith('{"t":"update"');
          const t0 = performance.now();
          listener.call(this, ev);
          if (isUpdate) { handler.push(performance.now() - t0); publish(); }
        }
      : listener;
    return original.call(this, type, wrapped, options);
  };
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (frames.length % 10 === 0) publish();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;
const vite = await createServer({
  root: new URL("..", import.meta.url).pathname,
  server: { port: 0 },
  define: { "import.meta.env.VITE_SERVER_URL": JSON.stringify(`ws://127.0.0.1:${wsPort}`) },
  logLevel: "silent",
  plugins: [
    {
      name: "bench-instrumentation",
      transformIndexHtml: (html) =>
        html.replace("<head>", `<head><script>${INSTRUMENTATION}</script>`),
    },
  ],
});
await vite.listen();
const viteUrl = vite.resolvedUrls?.local[0];
if (viteUrl === undefined) throw new Error("vite did not report a url");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/** Reads what the instrumentation wrote onto the document (shared by every script world). */
async function readSamples(): Promise<{ handler: number[]; frames: number[]; status: string }> {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute("data-bench") ?? '{"handler":[],"frames":[]}';
    const parsed = JSON.parse(raw) as { handler: number[]; frames: number[] };
    return {
      ...parsed,
      status: `${document.querySelector("#status")?.textContent ?? ""} hidden=${String(document.hidden)}`,
    };
  });
}
async function resetSamples(): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-bench-reset", String(Date.now()));
  });
}

const results: string[] = [
  "| zombies | handler median ms | handler p95 ms | frame p95 ms (tweens playing) | worst frame ms |",
  "| ---: | ---: | ---: | ---: | ---: |",
];
for (const count of ZOMBIE_COUNTS) {
  let state = boardState(count);
  let revision = 0;
  const connected = new Promise<import("ws").WebSocket>((resolve) => {
    wss.once("connection", (socket) => {
      socket.on("message", (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString()
          : Buffer.from(data as Buffer).toString();
        const decoded = decodeClientMessage(text);
        if (!decoded.ok) return;
        if (decoded.value.t === "create_match") {
          socket.send(
            encodeMessage({
              t: "joined",
              protocolVersion: PROTOCOL_VERSION,
              matchCode: "BNCH",
              playerId: playerId("p1"),
              rejoinToken: "bench-token",
              rejoined: false,
              matchStarted: false,
            }),
          );
          socket.send(
            encodeMessage({
              t: "lobby",
              matchCode: "BNCH",
              hostId: playerId("p1"),
              maxPlayers: 4,
              started: false,
              players: state.players.map((p) => ({
                id: p.id,
                name: p.name,
                specialty: p.specialty,
                present: true,
              })),
            }),
          );
          const { map, ...wire } = state;
          socket.send(encodeMessage({ t: "map", map }));
          socket.send(encodeMessage({ t: "update", revision, state: wire, events: [] }));
          resolve(socket);
        }
      });
    });
  });
  await page.goto(viteUrl);
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent?.startsWith("Connected"),
  );
  await page.fill("#lobby input[placeholder='Your name']", "Bench");
  await page.click("text=Create");
  const socket = await connected;
  await page.waitForSelector("#match:not([hidden])");
  await page.waitForTimeout(500);
  await resetSamples();
  for (let i = 0; i < UPDATES_PER_COUNT; i += 1) {
    const moved = step(state, i % 2 === 0 ? 1 : -1);
    state = moved.state;
    revision += 1;
    const { map: _map, ...wire } = state;
    socket.send(encodeMessage({ t: "update", revision, state: wire, events: moved.events }));
    await page.waitForTimeout(700);
  }
  const { handler, frames, status } = await readSamples();
  if (handler.length === 0) throw new Error(`no update handled: ${status}`);
  const frameP95 = frames.length === 0 ? "n/a" : percentile(frames, 0.95).toFixed(1);
  const worst = frames.length === 0 ? "n/a" : Math.max(...frames).toFixed(1);
  results.push(
    `| ${count} | ${percentile(handler, 0.5).toFixed(2)} | ${percentile(handler, 0.95).toFixed(2)} | ${frameP95} | ${worst} |`,
  );
  socket.close();
}
console.log(results.join("\n"));
await browser.close();
wss.close();
await vite.close();
