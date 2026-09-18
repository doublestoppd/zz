# Zombie Survival

A browser-based, turn-based, cooperative survival game for 1–4 players on a 2D tile map.
The server is authoritative; clients send intent and render the state they are given.

Current state: **all seven roadmap milestones complete**. Players join a lobby by code, spawn
in a procedurally generated city, take turns moving, shooting, and looting, survive the
zombie phase, and win by holding the extraction zone. See `docs/ARCHITECTURE.md` for the
roadmap and what was deliberately left out.

## Prerequisites

- Node.js 20.19 or newer
- pnpm 10 (`corepack enable` will provide it from `packageManager` in `package.json`)

## Setup

```sh
pnpm install
```

## Development

```sh
pnpm dev            # server on ws://localhost:8080 and client on http://localhost:5173
pnpm dev:server     # server only (PORT env var overrides 8080)
pnpm dev:client     # client only (VITE_SERVER_URL overrides ws://<host>:8080)
```

In development the server runs its TypeScript sources through `tsx`. `pnpm build` bundles it
with esbuild into a single `apps/server/dist/server.js` for production.

## Deployment

One Node process serves everything: `pnpm build`, then

```sh
PORT=8080 STATIC_DIR=apps/client/dist node apps/server/dist/server.js
```

serves the client at `/`, a health check at `/healthz`, the build identity at `/version`,
and the game over WebSocket on the same port; a built client connects to its own origin (`wss://` behind TLS). Set
`VITE_SERVER_URL` at build time to point the client elsewhere. The `Dockerfile` does the
same in a container (`docker build -t zombie . && docker run -p 8080:8080 zombie`).
Logs are JSON lines on stdout (errors on stderr). Terminate TLS in a reverse proxy; the
server itself speaks plain HTTP and WS. Matches live in memory, so a restart ends them.

Open `http://localhost:5173` in two browser tabs. In one, enter a name and **Create match**;
in the other, enter a name and the four-letter code and **Join**. The host presses
**Start match**. Click a highlighted tile to move or a red-outlined zombie to fire; press
**Reload** or **End turn** as needed. Click a door to open it, or use the door buttons to
close it behind you or force a locked door or window (loud). Step into buildings and search
the cabinets (**Q** or the Search button) for bandages, medkits, ammunition, and keys. Get
everyone into the green zone and hold it to win.

Balance values, the playtest checklist, and bot results are in `docs/BALANCE.md`.

Keyboard: arrows or WASD move one tile, **F** fires at the nearest zombie in range, **R**
reloads, **V** strikes an adjacent zombie with your knife or bat, **P** picks up (a weapon
on the ground swaps into your hands), **O** opens, **C** closes, **X** forces the door or
window next to you, **E** ends the turn. Sound effects are synthesized in the browser;
**Mute** remembers your choice. If the connection drops, the client reconnects and rejoins
on its own. Animations are skipped when the OS "reduce motion" setting is on.
Reloading a tab or losing the connection rejoins the match automatically; **Rejoin previous
match** covers the case where that did not happen.

## Checks

```sh
pnpm test           # all unit and integration tests (Vitest)
pnpm typecheck      # tsc --noEmit for every package
pnpm lint           # ESLint, including the architectural boundary rules
pnpm format:check   # Prettier
pnpm check          # all of the above
pnpm build          # client bundle (apps/client/dist) and server bundle (apps/server/dist/server.js)
```

## Repository map

| Path                      | Purpose                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `packages/game-core`      | Authoritative rules and simulation. No framework imports, no `Math.random`. |
| `packages/game-data`      | Survivor stats and rule numbers as plain data.                              |
| `packages/protocol`       | Client/server message types and decoders.                                   |
| `packages/map-generation` | Not yet created (Milestone 5).                                              |
| `apps/server`             | Lobby, sessions, match runtime, and the WebSocket adapter.                  |
| `apps/client`             | Phaser board rendering, DOM lobby and HUD, input.                           |
| `docs/`                   | Architecture, rules, protocol, development guide, and ADRs.                 |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — modules, dependency rules, data flow, owner map
- [Game rules](docs/GAME-RULES.md) — what the simulation currently does
- [Network protocol](docs/NETWORK-PROTOCOL.md) — every message, both directions
- [Development guide](docs/DEVELOPMENT.md) — how to add or change things
- [Architecture decision records](docs/adr/) — why the important choices were made
