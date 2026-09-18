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

| Directory      | Owns                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ids.ts`       | Branded `PlayerId`, `ZombieId`, `ItemId`, `MatchId` and their factories.                                                                                          |
| `state/`       | `GameState` and entity types; definitions (survivor, weapon, zombie, item, objective settings); barrier lookups; `createInitialState`; `validateMatchSetup`.      |
| `map/`         | `GameMap`, `Tile`, `Position`, position helpers, the ASCII map parser and the fixture map.                                                                        |
| `random/`      | The seeded `Rng`, `deriveSeed`, the named stream table, and `pickWeighted`.                                                                                       |
| `pathfinding/` | Breadth-first search: shortest path, reachable set, and `searchFrom` for many goals.                                                                              |
| `rules/`       | Board rules: occupancy and passability, movement, health and down status, line of sight, fire and reload, pick up and use item, search, noise, doors and windows. |
| `turn/`        | Turn order and eligibility; phase transitions; `advanceUntilPlayerInput`.                                                                                         |
| `zombies/`     | Zombie decision (`targetSelection.ts`: attack, pursue by sight, investigate noise, wait) and the per-round zombie phase.                                          |
| `objectives/`  | Objective primitives (`steps.ts`) and the scenario sequence around them (`objective.ts`): creation, end-of-round evaluation, zone tiles, progress summary.        |
| `commands/`    | Command and rejection unions; shared turn checks; `applyCommand`.                                                                                                 |
| `events/`      | The `GameEvent` union.                                                                                                                                            |
| `testing/`     | `makeTestState` builder used by tests only.                                                                                                                       |

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

| File                       | Owns                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `net/socketServer.ts`      | The only file that imports `ws`. Decodes text through protocol, answers malformed input, creates a `ClientSession` per socket, applies the socket limits. |
| `net/httpServer.ts`        | `/healthz`, `/readyz`, `/metrics`, the token-guarded `/admin/matches` diagnostics, and optional static serving of the built client on the same port.      |
| `errors.ts`, `log.ts`      | Fixed client-facing error texts; levelled JSON-line logging (`LOG_LEVEL`).                                                                                |
| `observability/metrics.ts` | Dependency-free counters, gauges, and fixed-bucket histograms rendered in the Prometheus text format. Written to by the socket server, registry, match.   |
| `session/ClientSession.ts` | Socket ↔ player slot bookkeeping.                                                                                                                         |
| `lobby/MatchRegistry.ts`   | Match codes, lookup, cleanup of abandoned matches.                                                                                                        |
| `match/ServerMatch.ts`     | Membership, host, rejoin tokens, presence, start, command handling, broadcasting.                                                                         |
| `match/MatchRuntime.ts`    | The single mutable reference to a `GameState` plus its revision counter.                                                                                  |
| `router.ts`                | Maps each `ClientMessage` to the registry or match method that owns it.                                                                                   |
| `testing/`                 | `ProtocolClient` (a real socket speaking the protocol) and `createServerHarness` for integration tests. Test-only.                                        |
| `soak/`                    | Greedy bot policy, the soak runner (bots over real sockets with invariant checks and failure persistence), and its CLI.                                   |
| `bench/`                   | Deterministic fixtures, the timing harness, the benchmark cases and CLI, and the budget tripwire test (`docs/PERFORMANCE.md`).                            |

### `apps/client`

| Directory | Owns                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `net/`    | WebSocket wrapper with automatic reconnect; `CommandSender` (one pending command at a time). No Phaser.                              |
| `state/`  | `ClientStore`: latest snapshot and revision, the events that produced it, identity, pending command id, log. No Phaser.              |
| `ui/`     | DOM lobby and HUD (buttons, inventory, mute, keyboard help, live regions), objective and outcome wording, rejection and log text.    |
| `render/` | Tile geometry; `planAnimations` (pure: events → steps); `BoardRenderer` playing steps as tweens, then reconciling Phaser objects.    |
| `input/`  | Pure intent functions: `decideClickIntent`, `decideMoveIntent`, `keyToCommand`.                                                      |
| `audio/`  | `SoundPlayer`: synthesized Web Audio tones per sound name, mute preference.                                                          |
| `scenes/` | The single Phaser scene: wires pointer and keyboard events to the intent functions. `main.ts` also imports Phaser to build the game. |
| `bench/`  | The client's pure per-update costs in Node; `apps/client/bench/renderBench.mts` drives the real page in headless Chromium.           |

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
The trust boundary is the socket: everything a client sends is untrusted until the
decoders in `packages/protocol` have rebuilt it field by field, and the limits at the
upgrade, the socket, and the lobby are listed in [SECURITY.md](SECURITY.md).

## Command processing

```
socket text
  -> protocol.decodeClientMessage      shape only; error MALFORMED_MESSAGE or rejected MALFORMED_COMMAND
  -> server.router                     which lobby/match owns this socket? (error NOT_IN_MATCH)
  -> ServerMatch.handleCommand         match started? duplicate commandId? baseRevision current?
                                       stamp playerId from the session
  -> MatchRuntime.apply
       -> game-core.applyCommand       turn checks -> rule validation -> new state + events
                                       -> advanceUntilPlayerInput (zombie phase, end of round)
       -> revision += 1 on success
  -> broadcast { t: "update", revision, commandId, state, events }
     or send { t: "rejected", commandId, reason, detail?, currentRevision }
```

`applyCommand` is pure. It returns a `CommandResult` value: either `{ ok, state, events }` or
`{ ok: false, reason }`. Rejection reasons form a closed union so both the compiler and the
client can enumerate them. On the wire the server maps them onto the protocol's closed set
of categories (`INVALID_PHASE`, `INVALID_ACTION`, `NOT_AUTHORIZED`) and keeps the game-core
reason as `detail`; the protocol adds its own categories for what game-core never sees
(`MALFORMED_COMMAND`, `MATCH_NOT_STARTED`, `DUPLICATE_COMMAND`, `STALE_REVISION`).

Command identity and revisions live in the protocol and the server, never in game-core:
`ServerMatch` keeps the last 256 command ids per player (with the player, so they survive a
reconnect) and `MatchRuntime` owns the revision. The full pipeline and the revision rule are
in [NETWORK-PROTOCOL.md](NETWORK-PROTOCOL.md), "Command reliability".

## Session identity and reconnection

A player is a member of a `ServerMatch` (public `playerId`, secret `rejoinToken`); a socket
is a transient attachment. Refreshing the browser is a reconnect: the client resends the
token, the server reattaches the socket, marks the player present (an authoritative
mutation), and sends `map` plus a full snapshot; the client rebuilds from it. The newest
socket wins a slot; the older one is told `SESSION_REPLACED`. The active player
disconnecting passes the turn at once; an absent player is skipped until they return; a
match nobody is connected to is kept ten minutes. Every policy decision is recorded in
[ADR 0007](adr/0007-session-identity-and-reconnect-policy.md).

## Match lifecycle and persistence

```
LOBBY -> STARTING -> ACTIVE -> COMPLETED
                        \-> ABANDONED
```

`ServerMatch.getStatus()` reports the state; `STARTING` is the synchronous window inside
`start()`. The persistence boundary is `MatchStore` (`apps/server/src/persistence/`): a
record (status, members with their tokens, journal) is saved after every accepted mutation
and at start, and an active match is rebuilt after a restart by replaying its journal, so
the revision and journal continue exactly. Files under `STATE_DIR`, or memory when unset.
Nothing in game-core knows any of this ([ADR 0009](adr/0009-persistence-strategy.md);
operations in [OPERATIONS.md](OPERATIONS.md)).

## Match journal and replay

`ServerMatch.mutate` is the one path every authoritative mutation takes; it appends a
journal entry (revision, command, round, phase, state fingerprint) on success. Commands are
the source of truth and events are derived. The journal carries the seed, versions,
scenario, layout source, and players, never a credential. `packages/game-core/src/replay/`
owns the types, the canonical fingerprint, and `replayJournal`; `apps/server/src/replay/`
rebuilds the initial state and verifies ([ADR 0008](adr/0008-match-journal-and-replay.md)).

Golden journals recorded by the real server live in `apps/server/fixtures/golden/`; the
test suite and CI replay them on every build so a rule change cannot go unnoticed
([DEVELOPMENT.md](DEVELOPMENT.md), "Continuous integration").

## State synchronisation

Full snapshot per update ([ADR 0002](adr/0002-plain-data-state-and-snapshot-sync.md)). The
static map is sent once per socket and each update carries the remaining state (about
2 KB), which changes at human speed. `revision` orders updates; a client ignores anything
older than what it has and asks for a `resync` when a command of its comes back
`STALE_REVISION`. Reconnection is "send the latest snapshot".

`game-core` has no notion of clients or sockets; `MatchRuntime` is the only mutable holder of
state on the server and `ServerMatch` the only broadcaster. On the client, rendering is a
function of the latest snapshot; events add log lines and (later) animation but are never
required to rebuild the board.

## Determinism

All randomness in authoritative code comes from an `Rng` passed explicitly. Its cursor is
stored in `GameState.rngState`, so a snapshot plus the commands that follow it replays
exactly ([ADR 0005](adr/0005-seeded-rng-carried-in-state.md)). The match seed derives
independent streams for gameplay and map generation.

## Versioning

`PROTOCOL_VERSION` gates the socket: the first message is `hello` and a client from
another protocol version is refused with `VERSION_MISMATCH` and told to refresh.
`SIMULATION_VERSION` names the deterministic rules; it is recorded in every journal and
replays of another version are refused. `GAME_VERSION` is the build label both sides
announce (`hello`, `welcome`, journals, the startup log). The bump rules are in
[DEVELOPMENT.md](DEVELOPMENT.md) and the decision in [ADR 0015](adr/0015-versioning.md).

## State invariants

`checkInvariants(state, level)` (`packages/game-core/src/state/invariants.ts`) lists every
assumption the rules rely on between commands: one solid entity per tile, every position on
a walkable tile inside the map, action points, health, and ammunition within their bounds,
down status matching zero health, an eligible active player whenever anyone is eligible,
the turn order a permutation of the players, phase and objective status agreeing, ids
unique, inventory and weapon references valid, objective steps well formed, counters
sane. `critical` is the cheap O(entities) subset (positions, occupancy, numbers, turn and
phase); `full` adds references and bookkeeping.

Where it runs: game-core tests assert the full set after every command of the random
play; the replay verifier refuses a journal whose replayed states violate it
(`INVARIANT_VIOLATION`, so a corrupt record is discarded at restore rather than served);
the soak checks every snapshot every bot receives; and `MatchRuntime.apply` checks the
state each accepted command produced, `critical` in production and `full` under
`INVARIANT_CHECKS=full`. A violation there is fail-safe: the mutation is discarded, the
previous state and revision stand, the sender gets the fixed `INTERNAL_ERROR` text, and
the server logs `state invariant violated` with the codes and counts
`zombie_invariant_violations_total`. Revision monotonicity is by construction (the
runtime is the only writer and adds exactly one per accepted command) and cross-checked
against the journal on every append ([ADR 0012](adr/0012-state-invariants.md)).

## Match/turn state machine

Defined by `GamePhase` and driven by `turn/phases.ts`; behaviour is described in
[GAME-RULES.md](GAME-RULES.md). The server never decides who is next; it only calls
`applyCommand` and broadcasts the result.

## Owner map

| Question                                                         | Owner                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Where is movement validated?                                     | `packages/game-core/src/rules/movement.ts`                                                                                |
| Where is passability (what blocks a path) defined?               | `packages/game-core/src/rules/occupancy.ts` (`passabilityFor`, `canStandOn`)                                              |
| Where does a turn advance?                                       | `packages/game-core/src/turn/phases.ts`                                                                                   |
| Where is turn eligibility decided?                               | `packages/game-core/src/turn/turnOrder.ts`                                                                                |
| Where are commands dispatched?                                   | `packages/game-core/src/commands/applyCommand.ts`                                                                         |
| Where are rejection reasons listed?                              | `packages/game-core/src/commands/rejection.ts` and the `rules/*.ts` validator each reason belongs to                      |
| Where are events defined?                                        | `packages/game-core/src/events/types.ts`                                                                                  |
| Where is weapon damage, range, and ammo validated?               | `packages/game-core/src/rules/combat.ts` (`validateFire`, `validateMelee`, `validateReload`)                              |
| Where do weapon swaps and ammunition kinds happen?               | `packages/game-core/src/commands/handlers/items.ts` (`equipWeapon`), reserves per `AmmoType` on the player                |
| Where is line of sight computed?                                 | `packages/game-core/src/rules/lineOfSight.ts`                                                                             |
| Where is damage applied, a survivor downed, or a zombie killed?  | `packages/game-core/src/rules/health.ts`                                                                                  |
| Where is zombie behaviour selected?                              | `packages/game-core/src/zombies/targetSelection.ts`                                                                       |
| Where are noises made, heard, and decayed?                       | `packages/game-core/src/rules/noise.ts`; intensities in `packages/game-data/src/{weapons,rules}.ts`                       |
| Where do doors and windows block movement or sight?              | `packages/game-core/src/state/barriers.ts`, read by `rules/occupancy.ts` and `rules/lineOfSight.ts`                       |
| Where are open, close, and force entry validated?                | `packages/game-core/src/rules/barriers.ts`; applied in `commands/handlers/barriers.ts`                                    |
| Where do specialties change costs and amounts?                   | `packages/game-core/src/rules/specialties.ts` (`modifiersOf`), read in search, barriers, combat, items                    |
| Where does pressure rise and where do waves spawn?               | `packages/game-core/src/rules/threat.ts`, called from `turn/phases.ts`; numbers in `packages/game-data/src/threat.ts`     |
| Where is the team's view computed and what does the server hide? | `packages/game-core/src/rules/visibility.ts`; `apps/server/src/match/redact.ts`                                           |
| Where do dynamic events fire and where are balance numbers?      | `packages/game-core/src/rules/dynamicEvents.ts`; every number in `packages/game-data/src/`, reviewed in `docs/BALANCE.md` |
| Where are pick-up and use-item validated?                        | `packages/game-core/src/rules/items.ts`                                                                                   |
| Where is searching validated and loot rolled?                    | `packages/game-core/src/rules/search.ts`; tables in `packages/game-data/src/containers.ts`                                |
| Where do containers get placed in buildings?                     | `packages/map-generation/src/templates/buildings.ts` (`c` cells and categories), collected in `city.ts`                   |
| Where is loot and the zombie type at each spawn rolled?          | `packages/game-core/src/state/createInitialState.ts` (`pickWeighted`)                                                     |
| Where is the objective created, evaluated, and summarised?       | `packages/game-core/src/objectives/` (`objective.ts`, `steps.ts`); scenarios in `packages/game-data/src/scenarios.ts`     |
| Where does defeat get decided?                                   | `packages/game-core/src/turn/phases.ts` (`resolveEndOfRound`)                                                             |
| Where are setup invariants checked?                              | `packages/game-core/src/state/validateSetup.ts`                                                                           |
| Where are survivor, weapon, zombie, item stats and rule numbers? | `packages/game-data/src/`                                                                                                 |
| Where are client/server messages defined?                        | `packages/protocol/src/messages.ts`                                                                                       |
| Where does the server decide who sent a command?                 | `apps/server/src/match/ServerMatch.ts` (`handleCommand`)                                                                  |
| Where are match codes and cleanup handled?                       | `apps/server/src/lobby/MatchRegistry.ts`                                                                                  |
| Where does the server choose the map?                            | `apps/server/src/lobby/MatchRegistry.ts` (`DEFAULT_DEPS.createLayout`)                                                    |
| Where does the client turn a click or key into a command?        | `apps/client/src/input/clickIntent.ts`, `input/keyboard.ts`                                                               |
| Where is objective and outcome wording?                          | `apps/client/src/ui/objectiveText.ts`                                                                                     |
| Where is the board drawn and animated?                           | `apps/client/src/render/BoardRenderer.ts`, `render/animationPlan.ts`                                                      |
| Where is the hard-coded test map?                                | `packages/game-core/src/map/testMaps.ts`                                                                                  |
| Where is map connectivity validated?                             | `packages/map-generation/src/validate/validateLayout.ts`                                                                  |
| Where are building templates and generation rules?               | `packages/map-generation/src/templates/buildings.ts` and `city.ts`                                                        |

## Roadmap

| Milestone                     | Status | Scope                                                                                                                                             |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Architecture                | done   | this document and the ADRs                                                                                                                        |
| 1 Multiplayer movement        | done   | lobby, sessions, turns, AP, move, end turn, sync, tests                                                                                           |
| 2 Zombie phase                | done   | zombie spawns, nearest-survivor targeting, step or attack, `down` status, defeat                                                                  |
| 3 Basic combat                | done   | pistol, ammo and reload, Chebyshev range, symmetric Bresenham line of sight, zombie death                                                         |
| 4 Extraction objective        | done   | end-of-round evaluation, holdout rounds, victory, match-over screen                                                                               |
| 5 Procedural city             | done   | road grid, lots with authored building templates, marker placement, validation, deterministic retry                                               |
| 6 Inventory and loot          | done   | ground items rolled from a loot table, small inventory, pick up, medkit and ammo box                                                              |
| 7 Presentation polish         | done   | event-driven tweens, synthesized sounds with mute, keyboard controls, health bars, auto-reconnect, a11y                                           |
| Audit follow-up               | done   | see [CODEBASE-AUDIT.md](CODEBASE-AUDIT.md) and its resolution log                                                                                 |
| Gameplay A Scavenging         | done   | searchable containers by building category, `search` command, deterministic per-container loot                                                    |
| Gameplay B Noise              | done   | gunfire and search noises, zombie sight range and line of sight, noise investigation with memory                                                  |
| Gameplay C Doors              | done   | door and window barriers with open/closed/locked/broken state, keys, forced entry through the noise system                                        |
| Gameplay D Weapons            | done   | shotgun falloff, rifle reach, knife and bat melee with knockback, ammunition kinds, weapon swapping by pick-up                                    |
| Gameplay E Archetypes         | done   | runner (fast, sharp-eyed) and brute (tough, slow, unshakable) as data plus two behaviour flags                                                    |
| Gameplay F Specialties        | done   | five lobby-selectable specialties as integer modifiers read at single extension points                                                            |
| Gameplay G Scenarios          | done   | objective primitives (reach, acquire, survive) sequenced into scenarios; retrieval scenario; host picks in lobby                                  |
| Gameplay H Threat             | done   | deterministic threat level from rounds, noise heat, and objective steps; scheduled reinforcement waves                                            |
| Gameplay I Fog of war         | done   | shared team visibility and explored grid in the state; server redacts unseen zombies and their events; client paints the fog                      |
| Gameplay J Events and balance | done   | car alarm, horde, and supply cache events composed from existing systems; balance pass, instrumentation logs, playtest matrix (`docs/BALANCE.md`) |

Deliberately not generalised yet: no quest engine, no entity-component system, no action
registry, no transport abstraction, no delta sync, no persistence or accounts, no plugin
system for content, no i18n.
