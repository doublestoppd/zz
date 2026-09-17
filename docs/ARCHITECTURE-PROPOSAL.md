# Architecture Proposal — Turn-Based Cooperative Zombie Survival

Status: **PROPOSAL, awaiting owner review**. Nothing in this document has been
implemented. Once accepted, the relevant parts move into `docs/ARCHITECTURE.md`
and `docs/adr/`, and this file is deleted or archived.

This proposal answers Section 12 of the project starter brief, item by item.

---

## 1. Technology stack

| Concern | Recommendation | Why | Alternatives considered |
|---|---|---|---|
| Language | TypeScript, `strict: true`, plus `noUncheckedIndexedAccess` | Discriminated unions and readonly types are the main tool for keeping rules explicit. `noUncheckedIndexedAccess` forces `tiles[y][x]` bounds checks to be written down. | Plain JS: rejected, loses the contract-by-types benefit. |
| Runtime | Node 20 LTS or newer | Long-term support, native `fetch`, stable ESM. | Deno/Bun: rejected, smaller ecosystem for Phaser tooling, no real gain. |
| Monorepo | pnpm workspaces, no Turborepo/Nx | Strict `node_modules` means a package can only import what its own `package.json` declares. That single property enforces most of the dependency-direction rules for free. Four packages and two apps do not need a task orchestrator. | npm workspaces: workable but hoists dependencies, so `game-core` could accidentally import Phaser and still compile. |
| Client rendering | Phaser 3 | Tilemaps, sprites, tweens, input, and scene lifecycle out of the box. For a 2D tile game this removes the most boilerplate for the least framework lock-in, and it is confined to `apps/client`. | PixiJS: lower level, more hand-written scene/input code. Raw canvas: too much boilerplate for animation. |
| Client bundler | Vite | Fast dev server, TS out of the box, standard pairing with Phaser. | Webpack: heavier config for no benefit. |
| Server transport | `ws` library on Node, native `WebSocket` in the browser, JSON messages defined in `packages/protocol` | The game is turn-based with tiny state (a few KB). A hand-written room/session layer is ~300 lines and keeps every message explicit and documented. Zero coupling between `game-core` and any networking framework. | Colyseus: gives rooms, matchmaking, and delta sync, but its `@colyseus/schema` requires class-based decorated state, which conflicts with "plain serializable state" and forces a mapping layer. Deferred; the adapter boundary in `apps/server` lets it be introduced later. Socket.IO: adds a protocol we do not need. |
| Message validation | Hand-written type guards in `packages/protocol` (`decodeClientMessage(raw): ClientMessage \| DecodeError`) | ~8 message types. A human can read the guard and see exactly what a message may contain. Keeps `protocol` dependency-free. | Zod: reasonable if message count grows; revisit at Milestone 6 (inventory) when payloads get richer. |
| Tests | Vitest | Runs TS directly, shares Vite config with the client, fast watch mode. | Jest: needs ts-jest/babel config for no gain. |
| Lint/format | ESLint (typescript-eslint) + Prettier, plus `no-restricted-imports` and `no-restricted-properties` (bans `Math.random`) per package | Mechanical enforcement of the two rules most likely to erode silently: forbidden imports and unseeded randomness. | dependency-cruiser: good tool, but pnpm strictness plus ESLint covers our needs with one fewer dependency. |
| Server dev runner | `tsx` (watch) for dev, `tsc` build for production | Minimal. | ts-node: slower, ESM friction. |

Deliberately no: state-management library, dependency-injection container,
ORM/database, immer (see risk R3), Turborepo, Docker in Milestone 1.

## 2. Repository and module structure

```
apps/
  client/                        Phaser rendering, input, HUD. Imports: protocol, game-core (types + read-only helpers).
    src/
      main.ts                    Boot Phaser, connect to server.
      net/                       WebSocket client; decodes ServerMessage; emits typed callbacks. No Phaser here.
      state/                     Holds latest authoritative snapshot + pending command. No Phaser here.
      scenes/                    BootScene, LobbyScene, MatchScene (Phaser lives here and below only).
      render/                    Tile layer + entity sprites reconciled from GameState by id.
      input/                     Click/tap -> intent (e.g. "move to tile"), forwarded to net/.
      ui/                        HUD: AP, active player, round, rejection toasts.
  server/                        Match lifecycle + networking adapter. Imports: protocol, game-core, game-data.
    src/
      index.ts                   HTTP + WebSocket bootstrap.
      net/                       ws adapter: accept sockets, decode/encode messages, per-socket send.
      session/                   ClientSession: socket <-> playerId <-> matchId. Presence tracking.
      lobby/                     Create/join match by short code; start when host says go.
      match/                     MatchRuntime: owns GameState + version + rng, applies commands, drives non-player phases, broadcasts.
packages/
  game-core/                     Authoritative rules and simulation. Imports: nothing runtime (game-data types only).
    src/
      ids.ts                     Branded ID types + id factories.
      state/                     GameState, PlayerState, ZombieState, ObjectiveState, GamePhase.
      map/                       GameMap, Tile, TileType, position helpers, testMaps/ (hard-coded fixtures).
      rules/                     movement.ts, actionPoints.ts; later lineOfSight.ts, combat.ts.
      turn/                      turnOrder.ts (who acts next), phases.ts (phase transitions), round.ts.
      commands/                  PlayerCommand union, ServerCommand union, applyCommand() dispatcher, rejection reasons.
      events/                    GameEvent union.
      zombies/                   (M2) zombiePhase.ts, targetSelection.ts, zombieMovement.ts.
      objectives/                (M4) extraction.ts, evaluateObjective().
      pathfinding/               bfs.ts (grid BFS, reachable set + path).
      random/                    Rng interface + seeded implementation.
      index.ts                   The only import path other packages may use.
  protocol/                      ClientMessage / ServerMessage unions, decode guards, message version. Imports: game-core (types only).
  game-data/                     WeaponDefinition, ZombieDefinition, balance constants as plain objects. Imports: nothing.
  map-generation/                (M5) seeded city generation + validation. Imports: game-core (GameMap, Rng).
docs/
  ARCHITECTURE.md  GAME-RULES.md  NETWORK-PROTOCOL.md  DEVELOPMENT.md  adr/
```

Packages expose a single `index.ts`. `apps/*` may not deep-import
`packages/*/src/...`; ESLint `no-restricted-imports` enforces this.

### Owner map (the "where is X?" table)

| Question | Owner |
|---|---|
| Where is movement validated? | `packages/game-core/src/rules/movement.ts` |
| Where is weapon damage calculated? | `packages/game-core/src/rules/combat.ts` (M3); numbers in `packages/game-data/src/weapons.ts` |
| Where does a turn advance? | `packages/game-core/src/turn/phases.ts` |
| Where is zombie behaviour selected? | `packages/game-core/src/zombies/targetSelection.ts` (M2) |
| Where are weapon stats stored? | `packages/game-data/src/weapons.ts` |
| Where are client/server messages defined? | `packages/protocol/src/messages.ts` |
| Where is map connectivity validated? | `packages/map-generation/src/validate/connectivity.ts` (M5); BFS itself in `game-core/pathfinding` |
| Where does the server decide who a command came from? | `apps/server/src/session/` |
| Where does the client turn a click into a command? | `apps/client/src/input/` |

## 3. Dependency direction

```
        game-data
            |
            v
map-generation ----> game-core <---- protocol
                      ^   ^             ^  ^
                      |   |             |  |
              apps/server |             |  apps/client
                          +-------------+
```

Allowed edges only: `game-data -> game-core` (types), `map-generation -> game-core`,
`protocol -> game-core` (types), `apps/server -> {game-core, game-data, protocol, map-generation}`,
`apps/client -> {protocol, game-core}`.

Forbidden and mechanically enforced: `game-core` importing Phaser, `ws`, DOM, or any app;
`protocol` importing Phaser or `ws`; `game-data` importing anything; anything importing
`apps/*`; circular imports between packages.

Why: the arrows point at the thing that changes least (rules) from the things that
change most (rendering, transport). Swapping Phaser or replacing `ws` with Colyseus
touches one app each and zero packages.

## 4. Core domain model

All authoritative state is plain JSON-serializable data: arrays and objects only,
no `Map`/`Set`/class instances/functions. This is what makes "broadcast a snapshot"
a one-liner and what makes tests trivially writeable as object literals.

```ts
// ids.ts — branded strings: a PlayerId cannot be passed where a ZombieId is expected.
type PlayerId = string & { readonly __brand: "PlayerId" };
type ZombieId = string & { readonly __brand: "ZombieId" };
type MatchId  = string & { readonly __brand: "MatchId" };

type GamePhase =
  | { kind: "player_turn"; activePlayerId: PlayerId }
  | { kind: "zombie_phase" }
  | { kind: "end_of_round" }
  | { kind: "finished"; outcome: "victory" | "defeat" };

interface GameState {
  readonly matchId: MatchId;
  readonly seed: number;          // the seed the match was created with (map + gameplay)
  readonly rngState: number;      // current cursor of the gameplay RNG (see §9)
  readonly round: number;         // starts at 1
  readonly phase: GamePhase;
  readonly turnOrder: readonly PlayerId[];   // fixed at match start; skipping is computed, not mutated
  readonly map: GameMap;
  readonly players: readonly PlayerState[];
  readonly zombies: readonly ZombieState[];  // empty in M1
  readonly objective: ObjectiveState;
}

interface Position { readonly x: number; readonly y: number; }

type TileType = "floor" | "wall";  // M1. Later: "road" | "sidewalk" | "door" | ...
interface Tile {
  readonly type: TileType;
  readonly walkable: boolean;
  readonly blocksVision: boolean;
}
interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly (readonly Tile[])[];  // tiles[y][x]
}

type PlayerStatus = "active" | "down" | "extracted";

interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly position: Position;
  readonly health: number;
  readonly maxHealth: number;
  readonly actionPoints: number;
  readonly maxActionPoints: number;
  readonly status: PlayerStatus;
  readonly present: boolean;      // false when disconnected; turn order skips absent players
}

type ZombieType = "walker";       // M2; more types are data, not code
interface ZombieState {
  readonly id: ZombieId;
  readonly type: ZombieType;
  readonly position: Position;
  readonly health: number;
}

// Objective is a discriminated union so a second mode can be added without a quest engine.
type ObjectiveState =
  | { readonly kind: "extraction";
      readonly extractionZone: readonly Position[];
      readonly status: "in_progress" | "complete" | "failed" };
```

Notes:
- `activePlayerId` lives inside the `player_turn` phase variant rather than as a
  nullable top-level field, so "there is an active player" and "it is a player turn"
  cannot disagree. This deviates from the brief's sketch on purpose.
- `present` is authoritative state because turn skipping is a game rule, not a
  networking detail. The server sets it through a `ServerCommand` (see §6).
- `turnOrder` is immutable for the match; `turnOrder.ts` computes "next eligible
  player" by skipping `present === false` or `status !== "active"`.
- Data definitions (`game-data`) are keyed by the union types above, e.g.
  `Record<WeaponType, WeaponDefinition>`; TypeScript then fails to compile if a
  type is added without its data.

## 5. Match/turn state machine

```
                 createInitialState(config, seed)
                             |
                             v
        +------------> player_turn(P = first eligible in turnOrder)
        |                    |
        |     EndTurnCommand | (also: MarkPlayerAbsent on the active player)
        |                    v
        |          next eligible player?  --yes--> player_turn(next)
        |                    | no
        |                    v
        |              zombie_phase          (M1: no zombies, passes straight through)
        |                    |  resolveZombiePhase(state, rng)
        |                    v
        |              end_of_round
        |                    |  resolveEndOfRound(state)  -> evaluateObjective
        |                    v
        |        objective complete/failed? --yes--> finished(victory | defeat)
        |                    | no
        +--- round + 1, AP refilled for all active players
```

Ownership:
- **All transition logic is in `game-core/src/turn/`** as pure functions:
  `endActiveTurn(state)`, `resolveZombiePhase(state, rng)`, `resolveEndOfRound(state)`,
  and `advanceUntilPlayerInput(state, rng)` which loops the non-player phases until
  the state is waiting on a player or finished.
- **The server decides *when* to call them.** After any accepted command,
  `MatchRuntime` calls `advanceUntilPlayerInput` and broadcasts the result. The
  server contains no rule about *who* is next or *whether* the round ends.
- A player turn ends only by explicit `EndTurnCommand` or by the active player
  becoming absent/down. Reaching 0 AP does not end the turn (the player may still
  perform 0-AP actions later, e.g. interact). Owner may change this; see review list.
- Match start requires all joined players to be present and the host to press
  start. Lobby is not a `GamePhase`; it is server session state.

## 6. Command model and event model

```ts
// commands/ — what a client is allowed to *ask* for. playerId is stamped by the server
// from the session, never taken from the client payload.
type PlayerCommand =
  | { readonly type: "move";     readonly playerId: PlayerId; readonly to: Position }
  | { readonly type: "end_turn"; readonly playerId: PlayerId }
  // M3: | { type: "fire_weapon"; playerId; targetId: ZombieId }
  //     | { type: "reload"; playerId }
  // M4+: | { type: "interact"; playerId; targetPosition: Position }

// Commands only the server may issue (never accepted from a socket).
type ServerCommand =
  | { readonly type: "set_player_presence"; readonly playerId: PlayerId; readonly present: boolean };

type Command = PlayerCommand | ServerCommand;

type CommandResult =
  | { readonly ok: true;  readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: RejectionReason };

// One typed union for all rejections; each command validator returns its own subset.
type RejectionReason =
  | "NOT_YOUR_TURN" | "WRONG_PHASE" | "MATCH_FINISHED" | "PLAYER_NOT_ACTIVE"
  | "INSUFFICIENT_ACTION_POINTS" | "DESTINATION_OUT_OF_BOUNDS" | "DESTINATION_BLOCKED"
  | "DESTINATION_OCCUPIED" | "OUT_OF_RANGE" | "UNKNOWN_PLAYER";

function applyCommand(state: GameState, command: Command): CommandResult;
```

Movement in M1: `to` may be any tile reachable within `actionPoints` steps
(4-directional BFS through walkable, unoccupied tiles); cost is 1 AP per step. The
server computes the path, not the client, so the client sends only the destination.
`PlayerMovedEvent` carries the full path so the client can animate it.

```ts
// events/ — what *happened*. Emitted by game-core, consumed by client (animation, log, audio)
// and by tests. Events never carry Phaser objects or presentation hints.
type GameEvent =
  | { readonly type: "player_moved";  readonly playerId: PlayerId; readonly path: readonly Position[]; readonly apSpent: number }
  | { readonly type: "turn_ended";    readonly playerId: PlayerId }
  | { readonly type: "turn_started";  readonly playerId: PlayerId; readonly round: number }
  | { readonly type: "round_started"; readonly round: number }
  | { readonly type: "phase_changed"; readonly phase: GamePhase }
  | { readonly type: "player_presence_changed"; readonly playerId: PlayerId; readonly present: boolean }
  | { readonly type: "match_ended";   readonly outcome: "victory" | "defeat" }
  // M2: zombie_moved, zombie_attacked  M3: weapon_fired, entity_damaged, entity_died
```

Why: a `CommandResult` is a value, so every rule is testable as
`expect(applyCommand(state, cmd)).toEqual(...)`. Rejection reasons are a closed
union, so the client can map each to a message and the compiler flags a missing case.

## 7. Network data flow

```
CLIENT                          SERVER                                 GAME-CORE
------                          ------                                 ---------
click tile (14,7)
  -> { t:"command", seq: 12,
       command:{type:"move", to:{x:14,y:7}} }
                     ---->  net/: decodeClientMessage(raw)
                              malformed? -> { t:"error", seq, code:"MALFORMED" } to sender, stop
                            session/: lookup playerId for this socket
                              not in a match? -> error, stop
                            match/: stamp playerId onto command
                                                                ---->  applyCommand(state, cmd)
                                                                       validate phase, active player,
                                                                       AP, bounds, walkable, occupancy, range
                                                                <----  { ok:false, reason } | { ok:true, state, events }
                            rejected? -> { t:"rejected", seq, reason } to sender only, stop
                            accepted:
                              state' = advanceUntilPlayerInput(state, rng)  (may add more events)
                              version++
                              broadcast { t:"update", version, state: state', events } to all in match
  <----  update: replace local snapshot,
         play animations from events,
         clear pending seq 12
```

Rejection handling: only the sender learns about a rejection; other clients see
nothing because nothing happened. The client keeps at most one pending command
(`seq`) and disables input until it is resolved, so there is no need for
client-side prediction or rollback in a turn-based game.

Message catalogue (M1, to be documented in `NETWORK-PROTOCOL.md`):

| Direction | Message | Payload | Response |
|---|---|---|---|
| C→S | `join` | `{ matchCode, playerName }` | `joined` or `error` |
| C→S | `start_match` | `{}` (host only) | `update` to all, or `error` |
| C→S | `command` | `{ seq, command: ClientCommand }` | `update` to all, or `rejected` to sender |
| C→S | `leave` | `{}` | `lobby` to remaining players |
| S→C | `joined` | `{ playerId, matchId, protocolVersion }` | – |
| S→C | `lobby` | `{ players: [{id,name,present}], hostId }` | – |
| S→C | `update` | `{ version, state, events }` | – |
| S→C | `rejected` | `{ seq, reason }` | – |
| S→C | `error` | `{ seq?, code, message }` | – |

`ClientCommand` is `PlayerCommand` with `playerId` omitted (`Omit<PlayerCommand, "playerId">`
distributed over the union), defined in `protocol`.

## 8. State synchronisation strategy

Full snapshot per update. Rationale: state is a few kilobytes, updates happen at
human speed (a few per second at most), and a snapshot is the simplest thing that
is always correct (no divergence bugs, trivial reconnection: send the latest
snapshot). Delta sync is a measured optimisation for later, if ever.

How `game-core` stays unaware of networking:
- `game-core` exports pure functions over plain data. It has no notion of clients,
  sockets, or broadcasting.
- `apps/server/src/match/MatchRuntime.ts` is the only place that holds mutable
  references (`state`, `version`, `rng`) and the only place that calls `send`.
- `protocol` defines the wire shape of `update` as literally `GameState`; because
  the state is plain data, `JSON.stringify` is the serializer. If the wire format
  later diverges from the domain shape, `protocol` gains an explicit
  `toWireState()` and nothing else changes.
- All clients receive the full state (no hidden information in the design yet;
  see assumptions). Reconnection = resend snapshot + set presence true.

Client side: `render = f(state)`. `render/` reconciles sprites by entity id against
the latest snapshot (create missing, remove stale, move existing). Events are used
only for transient animation and log lines; if an event were lost the board would
still be correct after the next snapshot.

## 9. Deterministic RNG

- `packages/game-core/src/random/` exports `interface Rng { next(): number; int(min, max): number; pick<T>(items: readonly T[]): T; getState(): number }`
  and `createRng(state: number): Rng` (splitmix32 or mulberry32: ~10 lines, documented,
  no dependency).
- Any `game-core` function that needs randomness takes `rng: Rng` as an explicit
  parameter (per brief §7.2). Functions that resolve a whole phase are responsible
  for writing `rng.getState()` back into the returned `GameState.rngState`. This
  invariant is documented on `resolveZombiePhase` and tested.
- Because `rngState` is inside `GameState`, **any snapshot plus the subsequent
  command list reproduces the match**, not just the initial seed. That is what makes
  a mid-match bug report replayable.
- `seed` seeds two independent streams via a mixing function: map generation
  (M5) and gameplay. Same seed → same map regardless of how much gameplay RNG
  was consumed.
- `Math.random` is banned by ESLint in `game-core` and `map-generation`. The
  server generates the initial `seed` (it may use `crypto.randomInt`), and that is
  the last non-deterministic thing in the pipeline.
- M1 uses zero randomness beyond seed generation; the plumbing exists so M2 does
  not have to retrofit it.

## 10. Testing strategy and boundaries

| Package | What is tested | How | Not tested |
|---|---|---|---|
| `game-core` | Every rule as observable behaviour: command validation, movement legality, AP accounting, turn/phase transitions, presence skipping, determinism (same state + commands twice → deep-equal), later LOS/combat/objective/zombie decisions | Vitest unit tests; a `makeTestState({...overrides})` builder over a hard-coded 10×10 fixture map so tests read as scenarios | Private helpers; no mocks anywhere |
| `protocol` | `decodeClientMessage` accepts every valid shape and rejects malformed/extra/missing fields; encode→decode round-trip | Table-driven unit tests | – |
| `game-data` | Every union member has a definition; values are within sane bounds | One test per catalogue (compile-time `Record<...>` does most of it) | – |
| `map-generation` (M5) | Same seed → identical map; N seeds → all pass connectivity/spawn/extraction validation | Property-style loops over seeds | Aesthetics |
| `apps/server` | Two in-process fake `ws` clients: join, start, move, end turn, receive broadcasts; rejection goes only to sender; disconnect skips turn | A handful of integration tests with a real `ws` server on an ephemeral port | Load, latency |
| `apps/client` | Pure helpers only (tile↔pixel maths, event→animation mapping) | Unit tests | Phaser scenes (typecheck only) |

Rules: no test may import Phaser or start a browser. `game-core` tests must run
in under a second. A reproducible bug gets a regression test that replays the
failing state + command.

## 11. Documentation structure and synchronisation

Files exactly as the brief lists. Mechanisms that keep them honest:
1. The feature-task template (brief §13) ends with a "documentation" step; the
   completion report must name which of the four docs changed or state "none affected".
2. `docs/ARCHITECTURE.md` contains the owner map from §2 above; adding a module
   means adding a row.
3. `docs/NETWORK-PROTOCOL.md` is structured one section per message, in the same
   order as the `ClientMessage`/`ServerMessage` unions in `protocol/src/messages.ts`;
   the union is the source of truth, the doc is the narrative. A small test can
   assert every `t:` literal appears in the doc (cheap, optional; proposed for M1).
4. `docs/GAME-RULES.md` describes implemented behaviour only; a feature is not
   done until its rule is written there in plain language.
5. ADRs are numbered `docs/adr/NNNN-title.md`, Context/Decision/Alternatives/
   Consequences, and are never edited after acceptance; a change gets a new ADR
   that supersedes the old one. Initial ADR set: 0001 server-authoritative
   simulation, 0002 plain-data state + snapshot sync, 0003 `ws` + hand-written
   protocol over Colyseus, 0004 Phaser for rendering, 0005 seeded RNG carried in state,
   0006 pure-function rules returning new state.
6. TSDoc on exported types in `game-core`, `protocol`, `game-data`; intent and
   invariants only.

## 12. Milestone plan

Each milestone is a separate branch/PR sequence and must be runnable, tested, and
documented before the next starts.

**M0 — Architecture (this document).** Output: accepted proposal, ADRs 0001–0006,
empty docs skeleton.

**M1 — Multiplayer movement slice.** Delivered as three reviewable steps:
- 1a `game-core`: ids, state, test map fixture, `createInitialState`, `applyCommand`
  for `move`/`end_turn`/`set_player_presence`, turn/phase functions, BFS, Rng, tests.
  Runnable entirely in Vitest.
- 1b `protocol` + `apps/server`: message unions and decoders, session/lobby,
  `MatchRuntime`, integration tests with fake clients. Playable with a trivial
  script client before any Phaser exists.
- 1c `apps/client`: Phaser tile render, click-to-move, end-turn button, HUD, lobby
  screen. Manual test: two browser tabs move survivors in turn order.
- Docs: README, ARCHITECTURE, GAME-RULES (movement/turns/AP), NETWORK-PROTOCOL, DEVELOPMENT.
- Deferred: zombies, combat, inventory, generation, reconnection UX beyond "rejoin by code".

**M2 — Zombie phase.** `ZombieState`, `game-data/zombies.ts` (one type), spawn from
map fixture, `resolveZombiePhase`: for each zombie, nearest active player by BFS
distance, step toward it or attack if adjacent (damage number from data), `down`
status at 0 HP. Events `zombie_moved`/`zombie_attacked`/`entity_damaged`. Determinism
test over the RNG. Client animates from events.

**M3 — Basic combat.** `fire_weapon`, `reload`; one weapon in `game-data`; range and
Bresenham LOS in `rules/lineOfSight.ts`; damage/death in `rules/combat.ts`; ammo on
`PlayerState`. Events `weapon_fired`/`entity_damaged`/`entity_died`. Client target
selection.

**M4 — Extraction objective.** `objectives/extraction.ts`: complete when all
non-down players stand in the zone at end of round (configurable holdout rounds
count); defeat when all players are down. `finished` phase, victory/defeat screen.
This is the first playable scenario.

**M5 — Procedural city.** `map-generation`: road grid + block templates + building
placement, spawn/extraction placement, validation (bounds, connectivity, reachable
extraction), deterministic retry. Replaces the fixture map behind the same
`GameMap` type.

**M6 / M7** as in the brief; not detailed here.

## 13. Major risks and decisions to settle before implementation

- **R1 Transport choice (`ws` vs Colyseus).** Cheap to change in M1, expensive by M3.
  Recommendation: `ws`; the `MatchRuntime`/`net` split keeps the option open.
- **R2 Snapshot vs delta sync.** Recommendation: snapshot; revisit only if state
  exceeds ~50 KB or updates become frequent (neither is plausible before M6).
- **R3 Immutable updates by hand.** Pure functions returning new state via spread
  are readable but verbose for nested `tiles[y][x]` or "update one player in an
  array". Recommendation: hand-written, with two or three tiny helpers
  (`replacePlayer(state, player)`). Immer is the fallback if this becomes error-prone;
  decide by end of 1a.
- **R4 Disconnect/reconnect semantics.** Proposal: presence flag, absent players
  skipped, rejoin by match code restores the same `PlayerId` (server keeps a
  per-player rejoin token). A match with zero present players is discarded after
  a timeout. Needs owner confirmation because it is player-visible.
- **R5 Explicit end-turn only, no auto-end at 0 AP.** Player-visible rule; confirm.
- **R6 4-directional movement, 1 AP per tile, no diagonals.** Affects map design and
  LOS later; confirm.
- **R7 Full state to all clients (no fog of war).** If hidden information is ever
  wanted, `protocol` gains a per-player view function; the domain does not change.
  Confirm it is acceptable for now.
- **R8 `activePlayerId` inside the phase union** rather than a nullable top-level
  field (deviation from the brief's sketch). Confirm.
- **R9 Hosting/deployment** is out of scope for M1; the server runs locally with
  `pnpm dev`. Confirm.

## 14. Deliberately not generalised yet

- No quest/scripting engine; `ObjectiveState` is a union with one member.
- No entity-component system; players and zombies are two concrete arrays.
- No generic "action registry"; commands are one discriminated union and one
  `switch`.
- No inventory model at all until M6 (ammo is a single number on the player in M3).
- No abstraction over the transport (no `Transport` interface); `net/` is a
  concrete `ws` adapter until a second transport actually exists.
- No persistence, accounts, authentication, or matchmaking beyond a join code.
- No delta sync, prediction, or rollback.
- No plugin/mod system for tile types, weapons, or zombies; adding one is editing
  a union and a data record (documented in DEVELOPMENT.md).
- No i18n; rejection reasons map to English strings in one client file.
- No multi-objective or PvP support.
