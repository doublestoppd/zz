# Zombie Survival

A browser-based, turn-based, cooperative survival game for 1–4 players on a 2D tile map.
The server is authoritative; clients send intent and render the state they are given.

Current state: **Milestones 1–5 complete**. Players join a lobby by code, spawn in a
procedurally generated city, take turns moving and shooting, survive the zombie phase, and
win by holding the extraction zone. Inventory and presentation polish are later milestones
(see `docs/ARCHITECTURE.md`).

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

The server runs its TypeScript sources directly through `tsx` (`pnpm --filter @zombie/server start`);
there is no separate compile step for it yet.

Open `http://localhost:5173` in two browser tabs. In one, enter a name and **Create match**;
in the other, enter a name and the four-letter code and **Join**. The host presses
**Start match**. Click a highlighted tile to move or a red-outlined zombie to fire; press
**Reload** or **End turn** as needed. Get everyone into the green zone and hold it to win.
Reloading a tab offers **Rejoin previous match**.

## Checks

```sh
pnpm test           # all unit and integration tests (Vitest)
pnpm typecheck      # tsc --noEmit for every package
pnpm lint           # ESLint, including the architectural boundary rules
pnpm format:check   # Prettier
pnpm check          # all of the above
pnpm build          # production client bundle (apps/client/dist)
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
