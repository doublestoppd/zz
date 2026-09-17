# Architecture

The project is a server-authoritative, turn-based multiplayer game. The rules live in a
framework-free package; the server and the browser client are thin adapters around it.
Decisions with real alternatives are recorded in [`adr/`](adr/).

## Modules

```
apps/
  client/   Phaser board rendering, DOM lobby and HUD, input.   Imports: protocol, game-core.
  server/   Lobby, sessions, match runtime, ws adapter.          Imports: protocol, game-core, game-data.
packages/
  game-core/       Authoritative rules and simulation.          Imports: nothing.
  game-data/       Survivor stats and rule numbers.             Imports: game-core (types only).
  protocol/        Message contracts and decoders.              Imports: game-core (types only).
  map-generation/  (Milestone 5) seeded city generation.        Imports: game-core.
```

### `packages/game-core`

| Directory      | Owns                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| `ids.ts`       | Branded `PlayerId`, `ZombieId`, `MatchId` and their factories.                             |
| `state/`       | `GameState` and entity types; `createInitialState`; player lookup/replace helpers.         |
| `map/`         | `GameMap`, `Tile`, `Position`, position helpers, the ASCII map parser and the fixture map. |
| `random/`      | The seeded `Rng`, `deriveSeed`, and the named stream table.                                |
| `pathfinding/` | Breadth-first search: shortest path and reachable set.                                     |
| `rules/`       | Board rules: occupancy, movement validation, legal destinations.                           |
| `turn/`        | Turn order and eligibility; phase transitions; `advanceUntilPlayerInput`.                  |
| `commands/`    | Command and rejection unions; shared turn checks; `applyCommand`.                          |
| `events/`      | The `GameEvent` union.                                                                     |
| `testing/`     | `makeTestState` builder used by tests only.                                                |

Public API is `src/index.ts`. Other packages may not import deeper paths (ESLint enforces it).

### `apps/server`

| File                       | Owns                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `net/socketServer.ts`      | The only file that imports `ws`. Decodes text through protocol, answers malformed input, creates a `ClientSession` per socket. |
| `session/ClientSession.ts` | Socket ↔ player slot bookkeeping.                                                                                              |
| `lobby/MatchRegistry.ts`   | Match codes, lookup, cleanup of abandoned matches.                                                                             |
| `match/ServerMatch.ts`     | Membership, host, rejoin tokens, presence, start, command handling, broadcasting.                                              |
| `match/MatchRuntime.ts`    | The single mutable reference to a `GameState` plus its version counter.                                                        |
| `router.ts`                | Maps each `ClientMessage` to the registry or match method that owns it.                                                        |

### `apps/client`

| Directory | Owns                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| `net/`    | WebSocket wrapper; `CommandSender` (one pending command at a time). No Phaser. |
| `state/`  | `ClientStore`: latest snapshot, identity, pending seq, log. No Phaser.         |
| `ui/`     | DOM lobby and HUD, rejection text, event log text, sessionStorage identity.    |
| `render/` | Tile geometry; `BoardRenderer` reconciling Phaser objects from state.          |
| `input/`  | `decideMoveIntent`: click → command, mirroring the server rule.                |
| `scenes/` | The single Phaser scene.                                                       |

## Dependency rules

```
        game-data
            |
            v
map-generation ----> game-core <---- protocol
                      ^   ^             ^  ^
              apps/server |             |  apps/client
                          +-------------+
```

Allowed: `game-data → game-core`, `map-generation → game-core`, `protocol → game-core`,
`apps/server → {game-core, game-data, protocol, map-generation}`, `apps/client → {protocol, game-core}`.

Forbidden and enforced by `eslint.config.js` plus pnpm's strict `node_modules`:

- any `packages/*` importing Phaser, `ws`, or an app;
- `Math.random` anywhere in `game-core` or `map-generation`;
- importing another package's `src/` internals;
- circular imports between packages.

Why: arrows point from what changes most (rendering, transport) to what changes least
(rules). Replacing Phaser or `ws` touches one app and no package.

## Server-authoritative model

Clients send intent (`move` to a destination, `end_turn`). The server stamps the sender's
`playerId` from the session, calls `applyCommand`, and either broadcasts the full new state
to everyone or sends a typed rejection to the sender. Clients never decide a position, an
action-point balance, or any other outcome. See [ADR 0001](adr/0001-server-authoritative-simulation.md).

## Command processing

```
socket text
  -> protocol.decodeClientMessage      shape only; MALFORMED_MESSAGE on failure
  -> server.router                     which lobby/match owns this?
  -> ServerMatch.handleCommand         stamp playerId from session
  -> MatchRuntime.apply
       -> game-core.applyCommand       turn checks -> rule validation -> new state + events
                                       -> advanceUntilPlayerInput (zombie phase, end of round)
  -> broadcast { t: "update", version, state, events }    or   send { t: "rejected", seq, reason }
```

`applyCommand` is pure. It returns a `CommandResult` value: either `{ ok, state, events }` or
`{ ok: false, reason }`. Rejection reasons form a closed union so both the compiler and the
client can enumerate them.

## State synchronisation

Full snapshot per update ([ADR 0002](adr/0002-plain-data-state-and-snapshot-sync.md)). The
state is a few kilobytes and changes at human speed. `version` orders updates; a client
ignores anything older than what it has. Reconnection is "send the latest snapshot".

`game-core` has no notion of clients or sockets; `MatchRuntime` is the only mutable holder of
state on the server and `ServerMatch` the only broadcaster. On the client, rendering is a
function of the latest snapshot; events add log lines and (later) animation but are never
required to rebuild the board.

## Determinism

All randomness in authoritative code comes from an `Rng` passed explicitly. Its cursor is
stored in `GameState.rngState`, so a snapshot plus the commands that follow it replays
exactly ([ADR 0005](adr/0005-seeded-rng-carried-in-state.md)). The match seed derives
independent streams for gameplay and map generation.

## Match/turn state machine

Defined by `GamePhase` and driven by `turn/phases.ts`; behaviour is described in
[GAME-RULES.md](GAME-RULES.md). The server never decides who is next; it only calls
`applyCommand` and broadcasts the result.

## Owner map

| Question                                           | Owner                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Where is movement validated?                       | `packages/game-core/src/rules/movement.ts`                             |
| Where does a turn advance?                         | `packages/game-core/src/turn/phases.ts`                                |
| Where is turn eligibility decided?                 | `packages/game-core/src/turn/turnOrder.ts`                             |
| Where are commands dispatched?                     | `packages/game-core/src/commands/applyCommand.ts`                      |
| Where are rejection reasons listed?                | `packages/game-core/src/commands/rejection.ts` and `rules/movement.ts` |
| Where are events defined?                          | `packages/game-core/src/events/types.ts`                               |
| Where are survivor stats and rule numbers?         | `packages/game-data/src/`                                              |
| Where are client/server messages defined?          | `packages/protocol/src/messages.ts`                                    |
| Where does the server decide who sent a command?   | `apps/server/src/match/ServerMatch.ts` (`handleCommand`)               |
| Where are match codes and cleanup handled?         | `apps/server/src/lobby/MatchRegistry.ts`                               |
| Where does the client turn a click into a command? | `apps/client/src/input/moveIntent.ts`                                  |
| Where is the board drawn?                          | `apps/client/src/render/BoardRenderer.ts`                              |
| Where is the hard-coded map?                       | `packages/game-core/src/map/testMaps.ts`                               |
| Where will weapon damage be calculated?            | `packages/game-core/src/rules/combat.ts` (Milestone 3)                 |
| Where will zombie behaviour be selected?           | `packages/game-core/src/zombies/` (Milestone 2)                        |
| Where will map connectivity be validated?          | `packages/map-generation/` (Milestone 5)                               |

## Roadmap

| Milestone              | Status | Scope                                                                 |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| 0 Architecture         | done   | this document and the ADRs                                            |
| 1 Multiplayer movement | done   | lobby, sessions, turns, AP, move, end turn, sync, tests               |
| 2 Zombie phase         | next   | zombie state, nearest-player targeting, step or attack, `down` status |
| 3 Basic combat         |        | one weapon, ammo/reload, range and line of sight, damage and death    |
| 4 Extraction objective |        | completion evaluation, holdout rounds, victory/defeat                 |
| 5 Procedural city      |        | seeded generation with validation, replacing the fixture map          |
| 6 Inventory and loot   |        | pickup/search, items, medkit/ammo                                     |
| 7 Presentation polish  |        | animation, audio, accessibility                                       |

Deliberately not generalised yet: no quest engine, no entity-component system, no action
registry, no transport abstraction, no delta sync, no persistence or accounts, no plugin
system for content, no i18n, no fog of war.
