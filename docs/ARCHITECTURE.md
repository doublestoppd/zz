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
  game-data/       Survivor, weapon, zombie, item, objective data. Imports: game-core (types only).
  protocol/        Message contracts and decoders.              Imports: game-core (types, plus the id factories).
  map-generation/  Seeded city generation and validation.       Imports: game-core.
```

### `packages/game-core`

| Directory      | Owns                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ids.ts`       | Branded `PlayerId`, `ZombieId`, `ItemId`, `MatchId` and their factories.                                                                    |
| `state/`       | `GameState` and entity types; definitions (survivor, weapon, zombie, item, objective settings); `createInitialState`; `validateMatchSetup`. |
| `map/`         | `GameMap`, `Tile`, `Position`, position helpers, the ASCII map parser and the fixture map.                                                  |
| `random/`      | The seeded `Rng`, `deriveSeed`, the named stream table, and `pickWeighted`.                                                                 |
| `pathfinding/` | Breadth-first search: shortest path, reachable set, and `searchFrom` for many goals.                                                        |
| `rules/`       | Board rules: occupancy and passability, movement, health and down status, line of sight, fire and reload, pick up and use item.             |
| `turn/`        | Turn order and eligibility; phase transitions; `advanceUntilPlayerInput`.                                                                   |
| `zombies/`     | Zombie decision (`targetSelection.ts`) and the per-round zombie phase.                                                                      |
| `objectives/`  | Objective creation, per-mode evaluation, zone tiles and progress summary; `extraction.ts` is the one mode so far.                           |
| `commands/`    | Command and rejection unions; shared turn checks; `applyCommand`.                                                                           |
| `events/`      | The `GameEvent` union.                                                                                                                      |
| `testing/`     | `makeTestState` builder used by tests only.                                                                                                 |

Public API is `src/index.ts`. Other packages may not import deeper paths (ESLint enforces it).

### `packages/map-generation`

| File                         | Owns                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `city.ts`                    | `generateCity`: road grid, lots, building placement, spawn/extraction/zombie placement, retry loop. |
| `templates/buildings.ts`     | Authored building footprints as ASCII and stamp rotation.                                           |
| `validate/validateLayout.ts` | Counts, walkability, distinctness, and reachability checks over a `MapLayout`.                      |
| `grid.ts`                    | Mutable working grid used only during generation.                                                   |

The generator returns the same `MapLayout` shape as the hand-authored fixture in game-core,
so nothing downstream knows which it is playing on. The server injects the layout factory
(`MatchDependencies.createLayout`); integration tests inject the fixture.

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

| Directory | Owns                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `net/`    | WebSocket wrapper with automatic reconnect; `CommandSender` (one pending command at a time). No Phaser.                              |
| `state/`  | `ClientStore`: latest snapshot, the events that produced it, identity, pending seq, log. No Phaser.                                  |
| `ui/`     | DOM lobby and HUD (buttons, inventory, mute, keyboard help, live regions), objective and outcome wording, rejection and log text.    |
| `render/` | Tile geometry; `planAnimations` (pure: events → steps); `BoardRenderer` playing steps as tweens, then reconciling Phaser objects.    |
| `input/`  | Pure intent functions: `decideClickIntent`, `decideMoveIntent`, `keyToCommand`.                                                      |
| `audio/`  | `SoundPlayer`: synthesized Web Audio tones per sound name, mute preference.                                                          |
| `scenes/` | The single Phaser scene: wires pointer and keyboard events to the intent functions. `main.ts` also imports Phaser to build the game. |

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
static map is sent once per socket and each update carries the remaining state (about
2 KB), which changes at human speed. `version` orders updates; a client
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

| Question                                                         | Owner                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Where is movement validated?                                     | `packages/game-core/src/rules/movement.ts`                                                           |
| Where is passability (what blocks a path) defined?               | `packages/game-core/src/rules/occupancy.ts` (`passabilityFor`, `canStandOn`)                         |
| Where does a turn advance?                                       | `packages/game-core/src/turn/phases.ts`                                                              |
| Where is turn eligibility decided?                               | `packages/game-core/src/turn/turnOrder.ts`                                                           |
| Where are commands dispatched?                                   | `packages/game-core/src/commands/applyCommand.ts`                                                    |
| Where are rejection reasons listed?                              | `packages/game-core/src/commands/rejection.ts` and the `rules/*.ts` validator each reason belongs to |
| Where are events defined?                                        | `packages/game-core/src/events/types.ts`                                                             |
| Where is weapon damage, range, and ammo validated?               | `packages/game-core/src/rules/combat.ts`                                                             |
| Where is line of sight computed?                                 | `packages/game-core/src/rules/lineOfSight.ts`                                                        |
| Where is damage applied, a survivor downed, or a zombie killed?  | `packages/game-core/src/rules/health.ts`                                                             |
| Where is zombie behaviour selected?                              | `packages/game-core/src/zombies/targetSelection.ts`                                                  |
| Where are pick-up and use-item validated?                        | `packages/game-core/src/rules/items.ts`                                                              |
| Where is loot and the zombie type at each spawn rolled?          | `packages/game-core/src/state/createInitialState.ts` (`pickWeighted`)                                |
| Where is the objective created, evaluated, and summarised?       | `packages/game-core/src/objectives/` (`createObjective.ts`, `evaluate.ts`, `extraction.ts`)          |
| Where does defeat get decided?                                   | `packages/game-core/src/turn/phases.ts` (`resolveEndOfRound`)                                        |
| Where are setup invariants checked?                              | `packages/game-core/src/state/validateSetup.ts`                                                      |
| Where are survivor, weapon, zombie, item stats and rule numbers? | `packages/game-data/src/`                                                                            |
| Where are client/server messages defined?                        | `packages/protocol/src/messages.ts`                                                                  |
| Where does the server decide who sent a command?                 | `apps/server/src/match/ServerMatch.ts` (`handleCommand`)                                             |
| Where are match codes and cleanup handled?                       | `apps/server/src/lobby/MatchRegistry.ts`                                                             |
| Where does the server choose the map?                            | `apps/server/src/lobby/MatchRegistry.ts` (`DEFAULT_DEPS.createLayout`)                               |
| Where does the client turn a click or key into a command?        | `apps/client/src/input/clickIntent.ts`, `input/keyboard.ts`                                          |
| Where is objective and outcome wording?                          | `apps/client/src/ui/objectiveText.ts`                                                                |
| Where is the board drawn and animated?                           | `apps/client/src/render/BoardRenderer.ts`, `render/animationPlan.ts`                                 |
| Where is the hard-coded test map?                                | `packages/game-core/src/map/testMaps.ts`                                                             |
| Where is map connectivity validated?                             | `packages/map-generation/src/validate/validateLayout.ts`                                             |
| Where are building templates and generation rules?               | `packages/map-generation/src/templates/buildings.ts` and `city.ts`                                   |

## Roadmap

| Milestone              | Status | Scope                                                                                                   |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 0 Architecture         | done   | this document and the ADRs                                                                              |
| 1 Multiplayer movement | done   | lobby, sessions, turns, AP, move, end turn, sync, tests                                                 |
| 2 Zombie phase         | done   | zombie spawns, nearest-survivor targeting, step or attack, `down` status, defeat                        |
| 3 Basic combat         | done   | pistol, ammo and reload, Chebyshev range, symmetric Bresenham line of sight, zombie death               |
| 4 Extraction objective | done   | end-of-round evaluation, holdout rounds, victory, match-over screen                                     |
| 5 Procedural city      | done   | road grid, lots with authored building templates, marker placement, validation, deterministic retry     |
| 6 Inventory and loot   | done   | ground items rolled from a loot table, small inventory, pick up, medkit and ammo box                    |
| 7 Presentation polish  | done   | event-driven tweens, synthesized sounds with mute, keyboard controls, health bars, auto-reconnect, a11y |
| Audit follow-up        | active | see [CODEBASE-AUDIT.md](CODEBASE-AUDIT.md) and its resolution log                                       |

Deliberately not generalised yet: no quest engine, no entity-component system, no action
registry, no transport abstraction, no delta sync, no persistence or accounts, no plugin
system for content, no i18n, no fog of war.
