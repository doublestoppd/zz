# Codebase Audit

Date: 2026-09-17. Audited commit: `9218916` (M7: presentation polish) on branch
`claude/new-session-phgpax`. Scope: the whole repository as it exists, not the architecture
as documented. No gameplay features were added and no refactoring was performed. The only
repository change made by this audit is this document.

All commands listed in §13 were executed; the results quoted are from those runs. Probe
scripts (procedural sweep, determinism fuzz, invariant probes) were run from temporary files
that were deleted afterwards; their code is reproduced in the appendix so the results can be
regenerated.

---

## Executive Summary

The codebase is in good health for its size (about 5,200 lines of source, 1,800 lines of
tests, 155 passing tests). The central architectural promises hold in the real code: the
domain package imports nothing from any framework, the server is the only writer of game
state, the client sends intent only, and every command is validated through one pure entry
point. Determinism holds under a 24,000-command fuzz with mid-match snapshot replays, and
the procedural generator produced 2,000 valid, fully connected cities without a single
failure.

The audit found **one critical correctness defect**: a survivor who is downed while their
teammates are disconnected becomes the active player, may still fire, and a returning
teammate can never get a turn. It is reachable in normal play and confirmed by a scripted
reproduction. Beyond that, the main risks are in multiplayer resilience rather than game
rules: the server does not detect duplicate or stale commands, has no payload cap, rate
limit, or liveness check, and resends the full 27 KB snapshot (93% of it the static map) on
every accepted command.

Extensibility is genuinely good for data-shaped additions (a stats-only weapon, a new
healing item) and moderate for behaviour-shaped ones. Two hard-coded assumptions
(`"walker"` at spawn time and the extraction objective at creation and in the HUD) and the
absence of any interaction or dynamic-tile concept mean a locked door would touch five
packages.

Finding counts: **1 critical, 4 high, 13 medium, 11 low.** Refactoring is recommended before
adding gameplay features, but the required work is a short sequence of small changes
(§Recommended Refactoring Plan, items 1 to 6), not an architectural rewrite.

---

## Current Baseline

| Area                  | Implementation (verified from code)                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client rendering      | Phaser 3.90 for the board (`apps/client/src/render`, `scenes`), plain DOM for lobby and HUD (`apps/client/src/ui`), Vite 8 bundler. Phaser is also imported by `apps/client/src/main.ts` to construct the game.                                                                      |
| Server                | Node 22, `ws` 8.21 WebSocket server in `apps/server/src/net/socketServer.ts`, hand-written lobby/session/match layer. No Colyseus. Runs through `tsx`; no compile step.                                                                                                              |
| Repository            | pnpm workspace: `packages/game-core`, `game-data`, `protocol`, `map-generation`; `apps/server`, `apps/client`. Root ESLint 10 flat config with boundary rules, Prettier, Vitest 5 with one project per package.                                                                      |
| Domain systems        | `game-core/src/{state,map,random,pathfinding,rules,turn,zombies,objectives,commands,events}`; `rules/` holds movement, occupancy, health, line of sight, combat, items.                                                                                                              |
| Authority model       | Server-authoritative. `apps/server/src/match/MatchRuntime.ts` is the only mutable holder of `GameState`; `ServerMatch.handleCommand` stamps `playerId` from the session and calls `applyCommand`. Full-state snapshot broadcast per accepted command; rejections to the sender only. |
| Map                   | Plain `GameMap { width, height, tiles[y][x] }` of shared immutable `Tile` records (`TILE_DEFINITIONS`); four tile types (floor, road, door, wall). `MapLayout` adds spawn, extraction, zombie, and loot positions.                                                                   |
| Procedural generation | `packages/map-generation/src/city.ts`: road grid, lots, six ASCII building templates rotated into lots, marker placement by BFS distance, `validateLayout`, deterministic retry (12 attempts).                                                                                       |
| Combat                | One weapon type (`pistol`), Chebyshev range, Bresenham line of sight blocked by `blocksVision` tiles only, deterministic damage, magazine and reserve ammo.                                                                                                                          |
| Zombie AI             | One type (`walker`). `zombies/targetSelection.ts`: attack adjacent, else one BFS step toward the nearest standing survivor, ties by turn order, waits if blocked. Runs in id order.                                                                                                  |
| Inventory             | `PlayerState.inventory: ItemType[]` with `inventoryCapacity`; ground items in `GameState.items`; two item types with an effect union (`heal`, `ammo`).                                                                                                                               |
| Objectives            | `ObjectiveState` is a one-member union (`extraction`); `objectives/extraction.ts` evaluated in `resolveEndOfRound` after the all-down defeat check.                                                                                                                                  |
| Protocol              | `packages/protocol/src/messages.ts`: 6 client messages, 5 server messages, JSON text frames, strict decoder for client input, shallow decoder for server output.                                                                                                                     |
| Persistence           | None. All state in server memory.                                                                                                                                                                                                                                                    |
| Testing               | 22 Vitest files, 155 cases. Unit tests in game-core, protocol, game-data, map-generation, client helpers; real-socket integration tests in `apps/server/src/server.test.ts`.                                                                                                         |
| Tooling               | `pnpm check` = typecheck + lint + format:check + test. `pnpm build` builds only the client. No CI config, Dockerfile, or deployment scripts.                                                                                                                                         |

### Documentation versus implementation

| Claim                                                      | Location                                  | Reality                                                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol` imports game-core "types only"                  | `docs/ARCHITECTURE.md` line 16            | `packages/protocol/src/decodeClientMessage.ts` imports runtime values `itemId` and `zombieId`. Dependency direction is still correct; the qualifier is wrong. |
| "Phaser is never imported outside `render/` and `scenes/`" | `docs/adr/0004-phaser-for-rendering.md`   | `apps/client/src/main.ts` imports Phaser to construct the game.                                                                                               |
| Zombies "have no health loss yet (combat milestone)"       | `docs/GAME-RULES.md` lines 84 to 85       | Stale since Milestone 3; zombies take damage and die.                                                                                                         |
| "Reloading a tab offers Rejoin previous match"             | `README.md` line 42                       | Since Milestone 7 the client rejoins automatically on socket open; the button still exists but is rarely needed.                                              |
| State is "a few kilobytes"                                 | `docs/ARCHITECTURE.md` line 124, ADR 0002 | A two-player snapshot on a generated city is 26,935 bytes, of which the map is 25,057.                                                                        |

Everything else checked in `README.md`, `ARCHITECTURE.md`, `GAME-RULES.md`, `NETWORK-PROTOCOL.md`,
`DEVELOPMENT.md`, and the six ADRs matched the code, including every file path they cite
(verified by script: zero missing paths) and the full error-code list.

---

## What Is Working Well

- **The framework boundary is real.** The import graph (generated from source, §Dependency
  Audit) shows `game-core` importing nothing but Vitest in tests. No `any` anywhere. Only one
  `eslint-disable` (a control-character regex in `decodeClientMessage.ts`). ESLint rejects
  Phaser, `ws`, deep imports, and `Math.random` in packages, and pnpm's strict `node_modules`
  makes an undeclared import fail to resolve.
- **Pure, closed-union rules.** `applyCommand` returns a value; every rejection reason is a
  member of `RejectionReason`, and the client's `REJECTION_MESSAGES` record fails to compile
  if one is missing. Rule validation order is documented in each validator's TSDoc and
  matches the tests.
- **Determinism is not aspirational.** The fuzz in the appendix replayed 60 seeded matches
  of 400 random legal commands twice and from JSON-round-tripped mid-match snapshots with
  zero divergence. The RNG cursor lives in state, so an `update` payload is a complete bug
  report.
- **Procedural generation is validated by construction and by test.** 2,000 seeds: no
  validation failures, no thrown attempts, no overlapping markers, no marker in a wall, no
  sealed door, and zero unreachable walkable tiles on any map. The 200-seed loop in
  `city.test.ts` guards this in the suite.
- **Server trust boundary is narrow and consistent.** Every command's `playerId` is replaced
  by the session's id (`ServerMatch.ts` line 172); a smuggled id is dropped by the decoder
  and tested (`server.test.ts` "ignores any playerId a client tries to smuggle in").
- **Data-driven balance.** Every number a designer would tune is in `packages/game-data`,
  and each `Record<Type, Definition>` makes a new union member a compile error until its data
  exists.
- **Documentation is unusually accurate for its volume.** Five drifts (above) in about 900
  lines of docs, and the owner map answers every "where is X?" question posed in the brief.

---

## Critical Issues

### C1. A downed survivor can become and remain the active player

**Files:** `packages/game-core/src/turn/phases.ts` line 90 (`resolveEndOfRound` falls back to
`turnOrder[0]` when no player is eligible), `packages/game-core/src/commands/turnChecks.ts`
(`requireActivePlayer` checks presence of the turn but never `status`),
`packages/game-core/src/turn/phases.ts` `reassignTurnIfActivePlayerAbsent` (only reacts to
`present === false`).

**Reproduction** (probe 1 in the appendix, executed): two players, P2 disconnected. P1 ends
their turn adjacent to a walker with 10 damage. Zombie phase downs P1. End of round: not
everyone is down (P2 is alive but absent), no eligible player exists, so the fallback makes
P1 active while `status: "down"`. Observed:

```
P1 after zombie phase: { status: 'down', health: 0, phase: { kind: 'player_turn', activePlayerId: 'p1' } }
Down active P1 can FIRE?  YES (bug)
P2 returns; active player is still p1 => P2 stuck? true
```

The move probe was rejected only because the destination tile happened to be occupied; the
turn checks themselves passed. The determinism fuzz, which toggles presence 5% of the time,
produced 668 states with a down active player across 60 matches, so this is not a corner
case.

**Why it matters:** an incapacitated survivor can act, and the match soft-locks for a
returning teammate until the 10-minute abandonment timer deletes it.

**Correction (not applied):** make eligibility one function used everywhere. `requireActivePlayer`
must reject `status !== "active"` (new reason, e.g. `PLAYER_NOT_ACTIVE`); `resolveEndOfRound`
must not fall back to an ineligible player (pause with no active player, or prefer the first
non-down player); and `reassignTurnIfActivePlayerAbsent` must reassign whenever the active
player is not eligible for any reason. Add a regression test from the reproduction.

---

## High-Priority Issues

### H1. No duplicate, stale, or out-of-order command detection on the server

**Files:** `apps/server/src/match/ServerMatch.ts` lines 166 to 179; `packages/protocol/src/messages.ts` (`CommandMessage.seq`).
`seq` is only echoed back in `rejected`; the server neither records it nor compares it. There
is no notion of the client's expected `version`. Probe 2 (executed): a solo player's
`end_turn` delivered twice ends two turns. In multiplayer a duplicated `end_turn` is
usually rejected as `NOT_YOUR_TURN`, but a duplicated `move`/`fire_weapon`/`use_item` from a
buggy or hostile client applies twice. The built-in client keeps one command pending, so
today this needs a non-standard client. **Correction:** track the last accepted `seq` per
member and reject repeats; have the client send the `version` it acted on and reject
`STALE_STATE` when it does not match.

### H2. Socket layer has no payload cap, rate limit, connection cap, or liveness check

**File:** `apps/server/src/net/socketServer.ts` line 32 (`new WebSocketServer({ port, host })`).
`ws` defaults `maxPayload` to 100 MiB (verified in `ws/lib/websocket-server.js` line 74). A
client can send arbitrarily many multi-megabyte frames that are fully buffered and
`JSON.parse`d before being rejected as malformed; nothing limits messages per second or
sockets per address; no ping/pong means a half-open connection stays "present" until TCP
gives up. **Correction:** `maxPayload` of a few KB, a simple token bucket per session, a
ping interval that terminates unresponsive sockets, and a connection ceiling.

### H3. Every update resends the static map

**Files:** `packages/protocol/src/messages.ts` (`UpdateMessage.state`), `apps/server/src/match/ServerMatch.ts` `updateMessage`.
Measured (probe 7): 26,935 bytes per snapshot, 25,057 of which is `state.map`. Four clients
and a 20-command round means about 2 MB per round for a 26x18 map. Cost grows with map area,
so a 60x40 map would send about 130 KB per accepted command. Not a problem at today's scale,
but it is the single thing that blocks "larger maps" (§Readiness). **Correction:** send the
map once (a `match_started` message or a `map` field on `joined`) and exclude it from
`update`, or send `update` as state-without-map plus a map version.

### H4. `createInitialState` trusts its inputs; no invariants on layout or rule numbers

**File:** `packages/game-core/src/state/createInitialState.ts`.
Probes 4 and 5 (executed): `moveCostPerTile: 0` is accepted and movement becomes free
(`affordableSteps` divides by it); two players can be placed on the same wall tile at
(0, 0). Today both the generator (`validateLayout`) and `game-data` happen to supply valid
values, so this is a latent defect, but the domain package is the one place that should
guarantee its own invariants, and the map-generation validator is not run on the fixture
map or on hand-authored layouts. **Correction:** validate `MatchSetup` (spawns in bounds,
walkable, distinct; every definition number positive; magazine size at least 1) and throw a
descriptive error.

---

## Medium-Priority Issues

| #   | Issue                                                                                   | Evidence                                                                                                                                                                                 | Why it matters                                                                                                                                           | Correction                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Objective creation and presentation are hard-coded to extraction                        | `createInitialState.ts` line 89 builds `kind: "extraction"`; `apps/client/src/ui/Hud.ts` lines 132 to 139 and `BoardRenderer.ts` line 226 read `extractionZone`/`holdoutRounds` directly | The `ObjectiveState` union exists but a second member would not compile until these three sites are rewritten; objective knowledge leaks into the client | Add `objectives/createObjective(layout, settings)` and a client-side `describeObjective(objective)` that switches on `kind`                          |
| M2  | Zombie type is hard-coded at spawn and behaviour has no per-type fields                 | `createInitialState.ts` line 65 `type: "walker"`; `ZombieDefinition` has only `maxHealth` and `damage`; `runZombiePhase` performs exactly one step                                       | A second archetype with different speed needs edits in the phase loop and a new spawn-typing mechanism                                                   | Add `movesPerPhase` (or similar) to `ZombieDefinition`; type zombie spawns in `MapLayout` or a spawn table in game-data                              |
| M3  | Item type list duplicated in protocol                                                   | `packages/protocol/src/decodeClientMessage.ts` line 84 `ITEM_TYPES` mirrors `ItemType` in `game-core/src/state/types.ts` line 57; `Hud.ts` also lists item buttons by hand               | A new item type compiles in game-core and game-data but is silently rejected by the decoder until the set is updated; the compiler does not catch it     | Export a runtime `ITEM_TYPES` array from game-core and derive the type from it; iterate it in protocol and the HUD                                   |
| M4  | Passability is composed ad hoc at every pathfinding call                                | `rules/movement.ts` lines 50 and 68, `zombies/targetSelection.ts` line 42, `map-generation/src/city.ts` line 112, `validateLayout.ts` line 62                                            | Any dynamic tile (door, rubble) must be remembered at each site; the locked-door exercise shows the cost                                                 | Introduce `isPassableFor(state, mover)` in `rules/occupancy.ts` and route all game-core callers through it                                           |
| M5  | Hidden coupling between player cap and spawn count                                      | `protocol/src/messages.ts` line 15 `MAX_PLAYERS = 4`; `map-generation/src/city.ts` line 32 `survivorSpawns: 4`; `createInitialState` throws if players exceed spawns                     | Changing either alone produces a server-side throw at match start rather than a compile error                                                            | Derive `survivorSpawns` from the player count passed to `createLayout` (the parameter already exists but is unused), or make one constant the source |
| M6  | Line of sight is asymmetric                                                             | `rules/lineOfSight.ts` Bresenham; probe 3: 36 of 726 in-range tile pairs on seed 5 differ by direction                                                                                   | Harmless today (only survivors shoot, and the client mirrors the server), but any ranged zombie or PvP would make cover direction-dependent              | Evaluate both directions or use a supercover line; add a symmetry test                                                                               |
| M7  | `applyCommand.ts` is a growing switch with inline handlers                              | 243 lines, six handlers, all in one file                                                                                                                                                 | Fine at six; the next two commands (interact, melee) push it past 300 lines with mixed concerns                                                          | Move each handler to `commands/handlers/<name>.ts` when the next command is added                                                                    |
| M8  | `BoardRenderer.ts` mixes reconciliation, animation playback, and three sprite factories | 368 lines, largest file in the repository                                                                                                                                                | Animation timing changes and sprite changes are in one file; playback state (`playbackToken`) is easy to break                                           | Split `AnimationPlayer` (steps to tweens) from `BoardRenderer` (state to sprites)                                                                    |
| M9  | `ServerMatch` owns lobby membership, presence, start, command routing, and broadcasting | 244 lines; `lobbyMessage` uses a sentinel `playerId("")` when there is no host (line 210)                                                                                                | Acceptable as "the room", but the sentinel is a weakly typed escape hatch that a client could misread                                                    | Make `hostId` optional in `LobbyMessage`; consider a `Lobby` object separate from the running match                                                  |
| M10 | Server integration tests depend on wall-clock timing                                    | `server.test.ts` line 89 `expectNone` waits 150 ms; lines 314 to 325 use 20/80 ms sleeps against a 50 ms TTL                                                                             | Flaky under load; a slow CI runner produces false failures                                                                                               | Use Vitest fake timers for the TTL test; replace `expectNone` sleeps with a server-side hook or a message counter                                    |
| M11 | Client reconnect briefly shows the lobby and a superseded tab stays "Connected"         | `main.ts` clears identity on close; `ServerMatch.rejoin` detaches the old session but its socket stays open                                                                              | Confusing UX during a blip; a second tab silently takes over the first with no notice in either                                                          | Keep the match view during reconnect; send the old session an explicit `error` (e.g. `SESSION_REPLACED`) and close it                                |
| M12 | No persistence; a server restart loses every match                                      | `MatchRegistry` is a `Map` in memory; clients get `MATCH_NOT_FOUND` on rejoin                                                                                                            | Documented, and fine for local play; blocks any deployment where restarts are routine                                                                    | Out of scope for now; snapshot-to-disk is straightforward because state is plain JSON                                                                |
| M13 | Important behaviours have no automated test (see §Testing Gaps)                         | No test for C1, H1, reconnect, `ClientStore`, or replay from a mid-match snapshot                                                                                                        | The two most serious findings were found by scripts, not the suite                                                                                       | Add the tests listed in §Testing Gaps                                                                                                                |

---

## Low-Priority Issues

| #   | Issue                                                                   | Evidence                                                                                                     | Note                                                                                                                                             |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | Lint relaxations                                                        | `eslint.config.js` line 42 turns off `no-unnecessary-condition`; line 98 allows non-null assertions in tests | Both deliberate and documented in the config; `no-unnecessary-condition` was disabled globally rather than per finding                           |
| L2  | `decodeServerMessage` is a cast                                         | `packages/protocol/src/decodeServerMessage.ts` line 28 `as unknown as ServerMessage`                         | Documented trust in the server; the only structural cast outside branded-id factories                                                            |
| L3  | Boundary lint rules do not cover apps                                   | `eslint.config.js` restricts `packages/**` only                                                              | `apps/client` could import `ws` and `apps/server` could import `phaser` without a lint error (pnpm would still require declaring the dependency) |
| L4  | Magic literal                                                           | `apps/client/src/ui/Hud.ts` line 197 `3000` ms rejection timeout                                             | Name it                                                                                                                                          |
| L5  | Speculative parameter                                                   | `zombies/zombiePhase.ts` `_rng` is accepted and unused                                                       | Kept for the documented extension point; harmless                                                                                                |
| L6  | Client bundle is one 1.2 MB chunk                                       | `pnpm build` warning                                                                                         | Phaser is not code-split; acceptable for a game, note for deployment                                                                             |
| L7  | No server build, Dockerfile, CI, health endpoint, or structured logging | Repository root                                                                                              | Deployment readiness (§Readiness)                                                                                                                |
| L8  | `PORT` parsing                                                          | `apps/server/src/index.ts` `Number(process.env.PORT ?? 8080)` yields `NaN` for garbage and `ws` throws       | Validate and fail with a message                                                                                                                 |
| L9  | Match codes are enumerable                                              | 24^4 = 331,776 codes, no join rate limit                                                                     | Only matters for public hosting; covered by H2's rate limit                                                                                      |
| L10 | Reserve ammo is unbounded                                               | `applyUseItem` adds rounds without a cap                                                                     | Design choice; note for balance                                                                                                                  |
| L11 | Player-name length counts UTF-16 code units                             | `isValidPlayerName`                                                                                          | A 20-emoji name is 40 units and rejected; cosmetic                                                                                               |

---

## Architecture Audit

Boundaries inspected from imports and code, not from the docs:

| Boundary                                     | Verdict   | Evidence                                                                                                                                  |
| -------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering code in domain logic               | Clean     | `packages/*` import no Phaser/DOM; lint forbids it; `grep -r phaser packages` is empty                                                    |
| Gameplay rules in networking                 | Clean     | `apps/server/src/router.ts` and `net/socketServer.ts` contain no rule; `ServerMatch.handleCommand` only stamps the id and forwards        |
| UI modifying authoritative state             | Clean     | Client never mutates `GameState`; `ClientStore` replaces the snapshot wholesale; intent functions return commands                         |
| Server/framework objects inside domain state | Clean     | `GameState` is plain data; sessions live in `ServerMatch` members, not in state; determinism fuzz JSON-round-trips snapshots successfully |
| Map generation depending on rendering        | Clean     | `map-generation` imports only `game-core`                                                                                                 |
| Game rules depending on client behaviour     | Clean     | Client mirrors rules (`decideMoveIntent`, `legalFireTargets`) but the server never relies on the mirror                                   |
| Objective knowledge in the client            | Leak (M1) | `Hud.ts` and `BoardRenderer.ts` read extraction fields directly                                                                           |
| Content knowledge in protocol                | Leak (M3) | `ITEM_TYPES` duplicated                                                                                                                   |

No violation of the six forbidden cases in the brief was found. The two leaks are
extensibility costs, not authority or determinism problems.

---

## Dependency Audit

Actual import graph, generated from `import ... from "@zombie/..."` statements (test files
excluded). `T` marks type-only imports, `R` runtime imports.

```
                 game-data ──T──▶ game-core ◀──R── map-generation
                                   ▲  ▲  ▲
                              R    │  │  │   R (itemId, zombieId) + T
                    protocol ──────┘  │  └───────────────── protocol
                       ▲  ▲           │
                    R  │  │  R        │ R
              apps/server  apps/client (also R: phaser, T/R: protocol)
              (also R: ws, node:crypto, map-generation, game-data)
```

- **Circular dependencies:** none between packages (verified: game-core imports no
  workspace package; each other package imports only game-core; apps import packages only).
- **Direction:** matches the documented diagram except that `protocol → game-core` is a
  runtime edge, not type-only (drift, not a violation).
- **Deep imports:** none (`grep "@zombie/[a-z-]+/src"` empty; lint rule present).
- **Duplicated abstractions:** the `ITEM_TYPES` set (M3); `Position` guards exist in both
  `protocol/guards.ts` and implicitly in `game-core` (`isInBounds`) but serve different
  layers, acceptable.
- **Third-party dependencies:** runtime `phaser`, `ws`; dev `vite`, `vitest`, `tsx`,
  `typescript`, `eslint` + `typescript-eslint`, `prettier`, `@types/*`. Nothing trivial or
  redundant. No PRNG, validation, or utility library was added.
- **Domain depending on infrastructure:** none.
- **Over-coupling:** `apps/client` imports 13 symbols from game-core across 8 files; this is
  by design (rule mirroring for UX) and every use is read-only.

---

## Maintainability Audit

Findings that describe a concrete problem, not size alone:

- **Growing switch in `applyCommand.ts` (M7).** Six inline handlers today; the pattern is
  fine but the file is the natural dumping ground for the next commands.
- **`BoardRenderer.ts` (M8)** couples two change reasons (what a state looks like, how a
  transition animates). The `playbackToken` cancellation protocol is subtle and lives next to
  sprite construction.
- **`ServerMatch` (M9)** is the one class that would become a "manager" if lobby features
  (kick, ready checks, settings) are added to it rather than beside it.
- **Hard-coded content decisions:** `"walker"` (M2) and `"extraction"` (M1) at creation;
  otherwise weapon, item, and zombie behaviour is data-driven through definitions.
- **Weak typing:** none material. Branded ids everywhere; one sentinel `playerId("")` (M9);
  one documented cast (L2); no `any`; non-null assertions only in tests.
- **Magic numbers:** balance values are in game-data; generation knobs are named constants in
  `city.ts`; client timings are named except one (L4).
- **Global or singleton state:** none in packages. The client's `main.ts` creates module-level
  singletons for the app shell, which is normal for an entry point.
- **Inheritance:** one `extends Phaser.Scene`, required by Phaser. No hierarchies.
- **Speculative abstraction:** none found. The `Rng` parameter on `runZombiePhase` is unused
  (L5) but is the documented seam for the next milestone.
- **Duplicated validation:** none. The client mirrors rules by calling the same game-core
  functions rather than re-implementing them.

---

## Extensibility Findings

Each exercise lists every file that would change today, judged by reading the code paths.
Nothing was implemented.

### 6.1 Pump-action shotgun

_Stats-only version_ (higher damage, shorter range, smaller magazine): 2 files.
`game-core/src/state/types.ts` (`WeaponType`), `game-data/src/weapons.ts`. Giving it to a
survivor: `game-data/src/survivors.ts`. The combat model supports this cleanly.

_Pump-action behaviour_ (must pump between shots): the model has no per-weapon behaviour
hook, only definition fields. Required: a `chambered`/`needsPump` flag on `EquippedWeapon`
(`state/types.ts`), a `WeaponDefinition.requiresPump` field, `validateFire` and
`applyFireWeapon` in `rules/combat.ts` and `commands/applyCommand.ts`, a `pump` command
(`commands/types.ts`, `protocol/decodeClientMessage.ts`, `client/ui/Hud.ts` or `input/keyboard.ts`),
a `weapon_pumped` event (`events/types.ts`, `client/ui/eventLog.ts`, `render/animationPlan.ts`),
and docs. About 9 files, all within the combat and command seams. **Verdict:** clean for
data, moderate for behaviour; the extension point is "add a definition field and read it in
`rules/combat.ts`", which is the intended shape. Weapon swapping would additionally need
inventory changes (weapons are not items).

### 6.2 Runner zombie

_Stats only:_ 2 files (`ZombieType`, `game-data/src/zombies.ts`). _Faster movement:_ stats
and behaviour are not independently variable today. `runZombiePhase` hard-codes one step, so
`ZombieDefinition` needs `movesPerPhase` and the phase loop must iterate (`zombies/zombiePhase.ts`).
_Spawning a mix:_ `createInitialState.ts` line 65 types every spawn `"walker"`; a spawn
table in game-data plus an rng roll (like `rollLoot`) or typed spawns on `MapLayout` are
needed, touching `map/asciiMap.ts`, `map-generation/src/city.ts`, and `validateLayout.ts`
if the layout carries types. Client: a colour per type in `BoardRenderer.ts` (optional).
About 6 files. **Verdict:** behaviour differences do not require invasive changes to the
decision logic (`decideZombieAction` is untouched), but the phase loop and spawn typing are
two hard-coded points that should become data first (M2).

### 6.3 Medkit

Already implemented. A second healing item (bandage): `ItemType` union, `game-data/src/items.ts`
(definition and loot weight), `protocol/decodeClientMessage.ts` `ITEM_TYPES` (M3),
`client/render/BoardRenderer.ts` `ITEM_LABELS` (compiler-enforced), `client/ui/Hud.ts`
use-button list (not compiler-enforced). 5 files, two of which are avoidable duplication.
Effects are cleanly extensible: a new effect kind is one union member and two exhaustive
switches. **Verdict:** clean; fix M3 to make it 3 files.

### 6.4 Alternate objective: retrieve an item and return to the start

Required: a new `ObjectiveState` member (`state/types.ts`); `objectives/retrieve.ts`;
dispatch on `objective.kind` in `turn/phases.ts` `resolveEndOfRound` (currently calls
`evaluateExtraction` directly); objective construction in `createInitialState.ts` line 89
(M1); a "start location" and "objective item location" on `MapLayout` (`map/asciiMap.ts`,
`map-generation/src/city.ts`, `validateLayout.ts`); a quest item type (`ItemType`,
game-data, protocol `ITEM_TYPES`, client labels); settings in `game-data/src/objectives.ts`
and `MatchSetup`; the server passing them (`ServerMatch.ts`); HUD text and board drawing
(`Hud.ts` lines 132 to 139, `BoardRenderer.ts` line 226); docs. About 13 files.
**Verdict:** the evaluation logic itself is isolated (one pure function per mode, as
intended), but three sites assume extraction (creation, HUD, renderer) and the map layout
has no generic "marker" concept, so the first alternate objective pays a one-time
generalisation cost (M1). No quest engine is needed.

### 6.5 Locked door requiring a key

Required across five packages: a `locked_door` `TileType` and definition (`map/types.ts`);
dynamic door state, since `Tile` records are shared immutable constants and `walkable` lives
on the tile (either replace the tile in `map.tiles` on unlock, or add a `doors: DoorState[]`
entity list and consult it in passability); an `interact` command family that does not
exist (`commands/types.ts`, `applyCommand.ts`, `protocol/decodeClientMessage.ts`,
`client/input/clickIntent.ts` or `keyboard.ts`, `Hud.ts`); `rules/interaction.ts`; a `key`
item type (`ItemType`, game-data, protocol, client labels); passability at every
pathfinding call site (M4: `rules/movement.ts` twice, `zombies/targetSelection.ts`,
`map-generation` validation must treat locked doors as passable-with-key when checking
reachability); line of sight (`blocksVision` on a locked door); template legend and key
placement (`templates/buildings.ts`, `city.ts`, `validateLayout.ts`); events
(`door_unlocked`) and client log, animation, colours; docs. About 16 files.
**Verdict: architectural weakness.** Three missing concepts make one simple feature
cross-cutting: no interaction command family (listed in the original brief's action table
but never scaffolded), no dynamic tile or interactable entity concept, and passability
composed ad hoc per caller. Introducing `isPassableFor` (M4) and an `interact` command
skeleton before this feature would reduce it to roughly 8 files.

---

## Domain Logic Audit

| Area                       | Status            | Notes                                                                                                                                                                                                                              |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movement                   | Correct           | Bounds, terrain, self-tile, occupancy, reachability, AP checked in documented order; path computed server-side; tests cover each reason. `legalMoveDestinations` and `validateMove` use the same passability predicate.            |
| Entity occupancy           | Correct, O(n)     | Players (any status) and zombies block; items do not. Down survivors block tiles (documented).                                                                                                                                     |
| Action points              | Correct           | Never negative (every cost validated first); refilled at round start; no auto end at zero (documented). `moveCostPerTile` not validated (H4).                                                                                      |
| Turn sequencing            | **Defect (C1)**   | Eligibility = present and active, but `requireActivePlayer` ignores status and end-of-round falls back to an ineligible player.                                                                                                    |
| Dead/incapacitated players | Partial           | Down survivors are skipped, ignored by zombies, and cannot be revived. C1 lets a down player act. `applySetPlayerPresence` ignores status (a down player reconnecting is handled correctly only because eligibility rejects them). |
| Zombie turns               | Correct           | Deterministic order; sees the board as previous zombies left it; queue behaviour tested. Attacks absent-but-standing survivors (documented design).                                                                                |
| Combat                     | Correct           | Order: target, range, sight, ammo, AP. Deterministic damage. Dead zombies removed.                                                                                                                                                 |
| Ammunition                 | Correct           | Magazine never below zero; reload bounded by magazine and reserve; reserve unbounded (L10).                                                                                                                                        |
| Inventory                  | Correct           | Capacity enforced; use validated; medkit refused at full health.                                                                                                                                                                   |
| Interactions               | Absent            | No `interact` command exists.                                                                                                                                                                                                      |
| Objectives / extraction    | Correct           | Defeat checked before victory; down survivors ignored; at least one standing survivor required; holdout reset on leaving.                                                                                                          |
| Map boundaries             | Correct           | `isInBounds` everywhere; tiles outside the map block sight; generator adds a wall ring but `parseAsciiMap` does not require one (BFS is still bounded).                                                                            |
| Line of sight              | Inconsistent (M6) | 5% of in-range pairs are direction-dependent.                                                                                                                                                                                      |
| Pathfinding                | Correct           | BFS, deterministic neighbour order, start tile always included; unreachable vs unaffordable distinguished.                                                                                                                         |
| Spawning                   | Trusting (H4)     | game-core does not check spawns; generator does; fixture is hand-checked.                                                                                                                                                          |
| Win/loss                   | Correct           | `finished` rejects every command (`MATCH_FINISHED`); tested.                                                                                                                                                                       |

States that should be impossible but can occur today: active player with `status: "down"`
(C1); a match with `moveCostPerTile: 0` (H4); two survivors on one tile via a bad layout (H4).

---

## Multiplayer Authority Audit

| Command               | Client supplies                   | Server validates                                                                                | Server calculates                                                | State changes                                             |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `move`                | destination `{x, y}` (integers)   | shape; session is in a started match; turn checks; bounds, terrain, occupancy, reachability, AP | shortest path, cost                                              | position, AP; `player_moved`                              |
| `fire_weapon`         | `targetId` string                 | shape; turn checks; target exists, range, line of sight, ammo, AP                               | damage, death                                                    | shooter AP and ammo, zombie health or removal; events     |
| `reload`              | nothing                           | turn checks; magazine not full, reserve not empty, AP                                           | rounds moved                                                     | ammo counters, AP                                         |
| `pick_up`             | `itemId` string                   | turn checks; item exists, on own tile, capacity, AP                                             | –                                                                | inventory, ground items, AP                               |
| `use_item`            | `itemType` (must be a known type) | turn checks; carried, effect useful, AP                                                         | heal amount capped, reserve added                                | health or reserve, inventory, AP                          |
| `end_turn`            | nothing                           | turn checks                                                                                     | next eligible player, zombie phase, end of round, objective, RNG | phase, round, AP refill, zombie state, objective, outcome |
| `set_player_presence` | never accepted from a socket      | n/a (server-issued from connection events)                                                      | turn reassignment                                                | `present`, possibly phase                                 |

Lobby messages (`create_match`, `join_match`, `rejoin_match`, `start_match`, `leave_match`)
are validated for shape, membership, host, capacity, name, and token. `playerId` in any
payload is discarded by the decoder (tested). The client never determines position, damage,
ammunition, AP, inventory, zombie decisions, random outcomes, objective completion, or the
outcome. **No trust-boundary violation found.** The only gaps are sequencing (H1), not
authority.

---

## Multiplayer Edge-Case Audit

| Scenario                             | Current behaviour                                                                                                                                                 | Classification                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Player disconnects during their turn | Marked absent; turn passes to the next eligible player if any, otherwise the match pauses on them                                                                 | Correctly handled (subject to C1 when the remaining players are down) |
| Player reconnects                    | `rejoin_match` with the stored token reattaches the slot, marks present, sends `lobby` and the latest `update`; turn reassigned if the active player is absent    | Correctly handled                                                     |
| Player refreshes the browser         | Identity in `sessionStorage`; the client auto-sends `rejoin_match` on socket open                                                                                 | Correctly handled (verified in Chromium during M7)                    |
| Player closes the browser            | Socket close → absent; slot kept; `sessionStorage` is per tab, so a new tab cannot rejoin without the token                                                       | Partially handled: rejoin impossible after closing the tab            |
| Disconnect during the zombie phase   | The zombie phase is synchronous inside `applyCommand`; the disconnect is processed after it, as an ordinary absence                                               | Correctly handled                                                     |
| Host disconnects                     | Lobby: host passes to the next member, or the lobby is deleted when empty. Started match: no host role remains                                                    | Correctly handled                                                     |
| Malformed command                    | `MALFORMED_MESSAGE` error to the sender; connection kept; tested                                                                                                  | Correctly handled                                                     |
| Command received twice               | Applied twice if still legal (probe 2)                                                                                                                            | **Potentially dangerous** (H1)                                        |
| Old or stale command                 | No version check; applied against current state if legal                                                                                                          | **Potentially dangerous** (H1)                                        |
| Command when not that player's turn  | `NOT_YOUR_TURN` to the sender only; tested                                                                                                                        | Correctly handled                                                     |
| Two tabs with the same session       | Second `rejoin_match` supersedes the first; the first tab is detached but keeps an open socket and a "Connected" status, and its next command gets `NOT_IN_MATCH` | Partially handled (M11)                                               |
| Client has stale state               | Every accepted command broadcasts the full snapshot; `version` discards older updates on the client; a stale client's command may still be applied (H1)           | Partially handled                                                     |
| Server restarts during a match       | All matches lost; rejoin returns `MATCH_NOT_FOUND`; client clears identity                                                                                        | Unsupported (M12, documented)                                         |
| Player joins a match in progress     | `MATCH_ALREADY_STARTED`; only rejoin by token                                                                                                                     | Correctly handled (by design)                                         |
| Fifth player joins                   | `MATCH_FULL`                                                                                                                                                      | Correctly handled, tested                                             |
| Every player disconnects             | Lobby deleted immediately; started match kept 10 minutes then deleted; tested                                                                                     | Correctly handled                                                     |
| Match remains abandoned              | Same timer; a finished match with players still connected is never cleaned until they leave                                                                       | Partially handled (finished matches linger)                           |

---

## Determinism Audit

- `Math.random`: zero occurrences in packages and app source; ESLint forbids it in
  `game-core` and `map-generation`. The server uses `node:crypto` for the seed and rejoin
  tokens only, outside the simulation.
- Timestamps: none affect gameplay. The only timers are the abandonment TTL and client UI.
- Collection iteration: turn order, zombies, items, and players are arrays; `Map`/`Set` are
  used only inside BFS (`positionKey` keyed, insertion-ordered) and the server registry.
- Target selection: ties broken by turn order (tested); zombie order by array order.
- Path tie-breaking: BFS neighbour order is fixed (up, right, down, left).
- Procedural generation: single `Rng` derived from the seed; 2,000 seeds regenerate identically
  (the 200-seed test plus the sweep).
- Reproduction: the appendix fuzz replayed 60 matches x 400 commands twice and from
  mid-match JSON snapshots with **0 mismatches**. A match is reproducible from seed, setup,
  and the ordered command list, and any `update` payload is a resumable snapshot.

Meaningful sources of nondeterminism: **none in the simulation.** The one caveat is that the
order in which the server applies commands from different sockets is arrival order, which
is the intended source of truth and is what the command log would record.

---

## Procedural Generation Audit

Sweep of seeds 0 to 1999 with `DEFAULT_CITY_OPTIONS` (script in the appendix), 3.8 ms per
seed:

| Check                                              | Result                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| Generator throws                                   | 0 seeds                                                       |
| `validateLayout` failures on output                | 0                                                             |
| Overlapping markers (spawn/extraction/zombie/loot) | 0                                                             |
| Markers on non-walkable tiles                      | 0                                                             |
| Walkable tiles unreachable from the survivor spawn | 0 tiles on 0 seeds (every interior is entered through a door) |
| Doors unreachable                                  | 0                                                             |
| Doors not connecting two walkable sides            | 0                                                             |
| Extraction path distance from spawn                | min 27, max 39 tiles                                          |
| Zombie path distance from spawn                    | min 11 tiles                                                  |
| Doors per map                                      | average 5.4, minimum 1                                        |

Observations rather than defects: a map with one door has few buildings (open lots); the
retry loop's attempt count is not observable, so the failure rate of the first attempt is
unknown (worth a debug counter if generation becomes slower); interiors are single empty
rooms.

---

## Testing Audit

### Coverage matrix

| System                                  | Unit                           | Integration (server)             | Multiplayer (2+ sockets) | Deterministic / replay | Procedural      |
| --------------------------------------- | ------------------------------ | -------------------------------- | ------------------------ | ---------------------- | --------------- |
| Movement, AP, occupancy                 | yes (11 + 8)                   | yes (move broadcast)             | yes                      | yes (command replay)   | –               |
| Turn sequencing, presence               | yes (11)                       | yes (disconnect/rejoin)          | yes                      | –                      | –               |
| Zombie decisions and phase              | yes (13)                       | yes (phase after round)          | yes                      | yes (rng cursor)       | –               |
| Combat, line of sight                   | yes (11)                       | rejection only                   | –                        | –                      | –               |
| Items, inventory, loot roll             | yes (10)                       | rejection + roll equality        | yes                      | yes (roll equality)    | –               |
| Objective / extraction                  | yes (7)                        | –                                | –                        | –                      | –               |
| Pathfinding, RNG, map parser            | yes (13)                       | –                                | –                        | –                      | –               |
| Protocol decoding                       | yes (5 table-driven, 22 cases) | implicit                         | –                        | –                      | –               |
| Lobby, host, codes, cleanup             | –                              | yes (12 cases)                   | yes                      | –                      | –               |
| Map generation                          | yes (8)                        | used by default server deps only | –                        | yes (seed equality)    | yes (200 seeds) |
| Client store / connection               | none                           | –                                | –                        | –                      | –               |
| Client intent, geometry, animation plan | yes (15)                       | –                                | –                        | –                      | –               |
| Rendering, Phaser scene, HUD, sounds    | typecheck only                 | –                                | –                        | –                      | –               |

### Test quality

- No mocks anywhere; server tests use real sockets on an ephemeral port.
- Timing-sensitive: `expectNone` (150 ms) and the TTL test (M10).
- Brittle by fixture: `server.test.ts` moves to (2, 1) and shoots `z1`, relying on
  `SMALL_TEST_MAP` layout; acceptable, but a fixture change breaks unrelated assertions.
- Redundant: `applyCommand.test.ts` and `combatCommands.test.ts` each re-check `NOT_YOUR_TURN`;
  harmless.
- Implementation-detail tests: none found; assertions are on returned values and events.
- `extraction.test.ts` "prefers defeat" originally contained a no-op command before being
  corrected; current version asserts the phase.

### Important untested behaviour (Testing Gaps)

1. C1: a downed survivor becoming active (the fuzz found 668 such states; the suite has zero).
2. Duplicate and stale command handling (H1).
3. Mid-match snapshot replay (the fuzz does it; the suite replays from the initial state only).
4. `ClientStore.applyServerMessage` (version discarding, pending clearing, log capping) and
   `GameConnection` reconnect scheduling.
5. Line-of-sight symmetry (M6) and `tilesBetween` on steep slopes.
6. `createInitialState` input validation (H4) once added.
7. The abandoned-match timer with fake timers instead of sleeps.
8. Two tabs / superseded session behaviour.

---

## Static Quality Checks

Executed at commit `9218916`:

| Command             | Result                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`    | all six packages: no errors                                                                          |
| `pnpm lint`         | no errors, no warnings                                                                               |
| `pnpm format:check` | "All matched files use Prettier code style!"                                                         |
| `pnpm test`         | 22 files, 155 tests passed in 3.2 s                                                                  |
| `pnpm build`        | client built (1,226 kB JS, 329 kB gzip) with the chunk-size warning (L6); server has no build script |
| `pnpm check`        | equivalent to the four checks above; passed                                                          |

Markers: `TODO`/`FIXME`/`HACK`/`TEMP`/`@ts-ignore`/`@ts-expect-error`: none. `any`: none.
`eslint-disable`: one (`packages/protocol/src/decodeClientMessage.ts` line 18, `no-control-regex`
for a deliberate control-character check; justified). Type assertions outside tests: four
branded-id factories in `ids.ts` (by design), one in `decodeServerMessage.ts` (L2), one
`JSON.parse(...) as Identity` in `identityStorage.ts` (client-local storage, low risk), and
five `entityId as PlayerId`/`ZombieId`/`ItemId` in `BoardRenderer.ts` where a union id is
looked up in typed maps (safe: a miss returns `undefined`). Non-null assertions outside
tests: none.

---

## Performance Review

| Area                                                                  | Today                                                                              | Classification                          | Note                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateMove` BFS over the whole map per command                     | 468 tiles, sub-millisecond                                                         | Irrelevant at expected scale            | Unbounded search is what distinguishes "unreachable" from "unaffordable"; bound it to `affordableSteps + 1` only if maps reach thousands of tiles |
| Zombie phase: one BFS per zombie per round                            | 5 x 468                                                                            | Irrelevant                              | 50 zombies on 10,000 tiles is still milliseconds                                                                                                  |
| `isOccupied` linear scan inside BFS                                   | tiles x entities = 468 x ~10                                                       | Worth monitoring                        | On 10,000 tiles x 100 entities it is 1M checks per BFS; precompute an occupancy set per search when that happens                                  |
| Line-of-sight per target per render                                   | zombies x path length                                                              | Irrelevant                              | Cheap                                                                                                                                             |
| `legalMoveDestinations` + `legalFireTargets` per render and per click | 2 BFS per update                                                                   | Irrelevant                              | Computed only on snapshot changes                                                                                                                 |
| Procedural generation                                                 | 3.8 ms per city                                                                    | Irrelevant                              | Even with retries                                                                                                                                 |
| State serialisation and broadcast                                     | 27 KB per update, 93% map                                                          | **Likely problem for larger maps** (H3) | Quadratic in map size; send the map once                                                                                                          |
| Phaser updates                                                        | Map drawn once; markers reconciled by id; two Graphics layers redrawn per snapshot | Irrelevant                              | Fine to hundreds of entities                                                                                                                      |
| Server registry lookups                                               | `Map` by code                                                                      | Irrelevant                              | –                                                                                                                                                 |

No immediate problems at the current 26x18, 4-player, 5-zombie scale.

---

## Documentation Audit

Drift found (all listed in §Current Baseline): five statements. Everything else, including
every cited file path and the error-code list, was verified against the code.

Can a new developer answer these from the docs?

| Question                                   | Answer in docs                                     | Clear?                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Where do I modify player movement?         | Owner map → `rules/movement.ts`                    | Yes                                                                                                                                           |
| Where do I add a weapon?                   | DEVELOPMENT "Add a weapon"                         | Yes                                                                                                                                           |
| Where do I add a zombie?                   | DEVELOPMENT "Add a zombie type"                    | Mostly: step 3 says "spawning ... currently spawns every Z as a walker" but does not say that `createInitialState` is where that happens (M2) |
| Where do I add an item?                    | DEVELOPMENT "Add an item"                          | Yes; it correctly lists the protocol and HUD steps that M3 would remove                                                                       |
| Where do I modify zombie behaviour?        | Owner map → `zombies/targetSelection.ts`           | Yes                                                                                                                                           |
| Where do I modify procedural generation?   | DEVELOPMENT "Change how the city is generated"     | Yes                                                                                                                                           |
| Where do I add a new objective?            | DEVELOPMENT "Add a game mode"                      | Partly: it omits `createInitialState` and the two client sites (M1)                                                                           |
| Where are network messages defined?        | Owner map → `protocol/src/messages.ts`             | Yes                                                                                                                                           |
| Where is authoritative command validation? | ARCHITECTURE "Command processing" → `applyCommand` | Yes                                                                                                                                           |
| Where do I change game-balance values?     | DEVELOPMENT "Change a rule number" → game-data     | Yes                                                                                                                                           |

---

## Security / Abuse Review

- **Client-calculated values:** none trusted (§Authority).
- **Arbitrary ids without ownership:** `pick_up.itemId` and `fire_weapon.targetId` are looked
  up and validated for position/range; `playerId` is never taken from the client. Rejoin
  tokens are UUIDs, compared with `Array.find` (not constant-time; irrelevant for 122-bit
  tokens over a network).
- **Commands targeting entities a player should not control:** impossible; every command
  acts on the session's own survivor.
- **Malformed input:** rejected with a fixed error text; the handler is wrapped in try/catch
  and logs to stderr only; no internal error text reaches clients.
- **Unbounded payloads:** yes (H2), 100 MiB default.
- **Spam:** no rate limit (H2); each accepted command triggers a full broadcast, so one client
  can make the server serialise 27 KB x N per message.
- **Unsafe property access / prototype pollution:** decoders use `isRecord` and read known
  keys only; `JSON.parse` does not assign `__proto__`; no object merging of client input.
- **Development-only behaviour:** none found; no debug endpoints or env-gated cheats.
- **Match-code enumeration:** feasible without rate limiting (L9).
- **Names:** length- and control-character-validated; rendered with `textContent` (no HTML injection).

---

## Recommended Refactoring Plan

Small, independently reviewable changes in priority order. None were started.

1. **Enforce active-player eligibility everywhere (C1).** Files: `turn/turnOrder.ts`,
   `turn/phases.ts` (`resolveEndOfRound` fallback, `reassignTurnIfActivePlayerAbsent` → rename
   to `reassignTurnIfActivePlayerIneligible`), `commands/turnChecks.ts`, `commands/rejection.ts`
   (new reason), client `rejectionMessages.ts`, GAME-RULES. Benefit: removes the only known
   soft-lock and the only way for a down survivor to act. Risk: low; touches one invariant.
   Tests: the reproduction from this audit as a regression test; presence + down combinations
   in `phases.test.ts`; fuzz assertion that the active player is always eligible.
2. **Command sequencing on the server (H1).** Files: `protocol/messages.ts` (add
   `expectedVersion` to `command`, new error/rejection code), `decodeClientMessage.ts`,
   `ServerMatch.ts` (last `seq` per member, version comparison), client `CommandSender.ts`,
   NETWORK-PROTOCOL. Benefit: duplicates and stale commands are rejected, not applied. Risk:
   low-medium; a protocol version bump. Tests: server integration cases for duplicate and stale
   `seq`, decoder cases.
3. **Socket hardening (H2).** Files: `net/socketServer.ts` (`maxPayload`, ping interval,
   connection cap), `ServerMatch` or `ClientSession` (token bucket), `index.ts` (`PORT`
   validation). Benefit: resistance to trivial abuse; dead sockets detected. Risk: low.
   Tests: oversized frame closes the socket; rate limit returns an error; `PORT` validation.
4. **Send the map once (H3).** Files: `protocol/messages.ts` (map on `joined`/new
   `match_started`, `update.state` without `map` or a `MapId`), `ServerMatch.ts`, client
   `ClientStore.ts` and `BoardRenderer.ts`, `decodeServerMessage.ts`, NETWORK-PROTOCOL, ADR 0002
   amendment. Benefit: updates shrink about 13x; larger maps become possible. Risk: medium;
   the client must reassemble `GameState` for rule mirroring. Tests: integration round trip;
   store tests.
5. **Validate `MatchSetup` in `createInitialState` (H4).** Files: `state/createInitialState.ts`
   (or a new `state/validateSetup.ts`), tests. Benefit: the domain guarantees its own
   invariants regardless of caller. Risk: low. Tests: each invariant rejected with a message.
6. **Central passability (M4).** Files: `rules/occupancy.ts` (`isPassableFor`), `rules/movement.ts`,
   `zombies/targetSelection.ts`. Benefit: one place to teach the game about doors or rubble
   later. Risk: low; pure refactor with identical behaviour. Tests: existing movement and
   zombie tests must pass unchanged; add one test that both callers use the shared predicate.
7. **Generalise objective creation and presentation (M1).** Files: `objectives/createObjective.ts`,
   `createInitialState.ts`, client `ui/objectiveText.ts` (new, pure) used by `Hud.ts`,
   `BoardRenderer.ts` (draw by `kind`), DEVELOPMENT. Benefit: a second mode touches only
   objective files. Risk: low. Tests: unit test for the text function; existing extraction tests.
8. **Typed zombie spawns and `movesPerPhase` (M2).** Files: `state/definitions.ts`,
   `game-data/src/zombies.ts`, `zombies/zombiePhase.ts`, `createInitialState.ts`, `map/asciiMap.ts`
   or a spawn table in game-data, `validateLayout.ts`, DEVELOPMENT. Benefit: a Runner becomes
   data. Risk: low-medium (layout shape change). Tests: phase test with `movesPerPhase: 2`;
   spawn typing determinism.
9. **Single source for item types (M3).** Files: `state/types.ts` (`ITEM_TYPES` array, type
   derived), `protocol/decodeClientMessage.ts`, client `Hud.ts` (iterate), DEVELOPMENT. Benefit:
   a new item is two files. Risk: low. Tests: decoder accepts every listed type.
10. **Documentation corrections (§Documentation Drift).** Files: GAME-RULES, ADR 0004,
    ARCHITECTURE (two lines), README, ADR 0002 note. Benefit: docs match code. Risk: none.
11. **Deterministic server tests (M10).** Files: `server.test.ts`. Benefit: no timing flakes.
    Risk: low. Tests: same cases under fake timers.
12. **Add the missing tests (§Testing Gaps).** Files: new `ClientStore.test.ts`,
    `GameConnection.test.ts` (with a fake socket), a suite-level fuzz/replay test in game-core
    (small seed count to keep it under a second), LOS symmetry test.
13. **Line-of-sight symmetry (M6).** Files: `rules/lineOfSight.ts`, tests, GAME-RULES. Benefit:
    cover is direction-independent before any ranged enemy exists. Risk: low; slightly
    stricter sight.
14. **Split `applyCommand.ts` handlers (M7)** when the next command is added. Files:
    `commands/handlers/*.ts`. Benefit: one file per command. Risk: none. Tests: unchanged.
15. **Split `BoardRenderer.ts` (M8).** Files: `render/AnimationPlayer.ts`, `render/BoardRenderer.ts`.
    Benefit: playback logic testable in isolation with a fake tween manager. Risk: low.
16. **Superseded-session notice and reconnect UX (M11).** Files: `ServerMatch.rejoin`,
    `protocol` (new error code), client `main.ts` (keep the match view while reconnecting).
17. **App-level boundary lint (L3).** Files: `eslint.config.js`. Benefit: `apps/client` cannot
    import `ws`, `apps/server` cannot import `phaser` or the other app.
18. **Deployment basics (L7, L8).** Files: `apps/server/package.json` (esbuild bundle script),
    `Dockerfile`, a `/healthz` HTTP route in `socketServer.ts`, structured logging. Benefit:
    deployable. Risk: low.

Items 1 to 6 are recommended before any new gameplay feature; 7 to 9 before the specific
features they unlock; the rest as capacity allows.

---

## Readiness Assessment

| Target                                           | Ready?  | What remains                                                                                                                        |
| ------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Additional weapons (stats-only)                  | Yes     | Nothing; two files per weapon                                                                                                       |
| Weapons with new behaviour (pump, spread, melee) | Mostly  | Add definition fields and read them in `rules/combat.ts`; melee needs a new command through the same seam                           |
| Additional zombies (stats-only)                  | Yes     | Two files                                                                                                                           |
| Zombies with different movement or spawning      | Not yet | Plan item 8                                                                                                                         |
| More game modes                                  | Not yet | Plan item 7; the evaluation seam is ready, creation and presentation are not                                                        |
| Larger maps                                      | Not yet | Plan item 4 (map once per session); then monitor `isOccupied` inside BFS                                                            |
| Public multiplayer testing                       | Not yet | Plan items 1, 2, 3 are prerequisites (soft-lock, duplicate commands, abuse limits); item 16 for UX; a TLS-terminating reverse proxy |
| Deployment                                       | Not yet | Plan item 18 plus a decision on persistence (M12); currently `pnpm dev` only                                                        |

---

## Appendix: Commands and Probe Scripts

Commands executed during the audit, in order (all from the repository root):

```
git status --short && git log --oneline | head -3
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
grep -rnE "TODO|FIXME|HACK|TEMP\b|@ts-ignore|@ts-expect-error|eslint-disable" --include=*.ts --include=*.js packages apps eslint.config.js docs README.md
grep -rnE ":\s*any\b|<any>|as any" --include=*.ts packages apps
grep -rnE "\bas\s+[A-Z][A-Za-z0-9_<>\[\]]*" --include=*.ts packages apps   # excluding tests and "as const"
grep -rnE "Math\.random|Date\.now|new Date\(|performance\.now" --include=*.ts packages apps
grep -rhoE 'from "(@zombie/[a-z-]+[^"]*|phaser|ws|node:[a-z]+)"' --include=*.ts <each package>/src | sort | uniq -c
grep -rnE "@zombie/[a-z-]+/src" --include=*.ts packages apps              # deep imports: none
find packages apps -name "*.ts" -not -name "*.test.ts" | xargs wc -l | sort -rn | head
<doc path check>: every `path.ts` in docs resolved with find; zero missing
grep -n maxPayload node_modules/.pnpm/ws@8.21.3/node_modules/ws/lib/websocket-server.js
node_modules/.bin/tsx apps/server/audit-procgen.tmp.ts        # 2,000-seed sweep (script below)
node_modules/.bin/tsx apps/server/audit-determinism.tmp.ts    # 60 x 400-command fuzz (script below)
node_modules/.bin/tsx apps/server/audit-probes.tmp.ts         # C1 reproduction and invariant probes (script below)
```

The three temporary scripts were placed in `apps/server/` so that workspace packages
resolve, run once, and deleted. Their essential logic:

**Procedural sweep.** For seeds 0 to 1999: `generateCity({ ...DEFAULT_CITY_OPTIONS, seed })`,
`validateLayout` on the result, then BFS from the first spawn with every tile passable to
count walkable-but-unreachable tiles, unreachable doors, and doors without two walkable
sides on one axis; check marker overlap and walkability; record min/max spawn-to-zone and
minimum zombie path distances.

**Determinism fuzz.** For seeds 0 to 59: build a 3-player match on the generated city; with
`createRng(seed * 7 + 1)` pick a random legal command each step (move to a legal
destination, fire at a legal target, reload when possible, pick up when standing on an
item, use the first carried item, end turn, or with 5% probability toggle a random player's
presence) for 400 steps; record `JSON.stringify(state)` after each; run twice and compare;
then take the snapshot at the midpoint, `JSON.parse` it, and replay the remaining commands
comparing each result. Also count states whose active player has `status: "down"`.

**Probes.** (1) C1 reproduction as described; (2) solo `end_turn` twice; (3) line-of-sight
symmetry over tile pairs within range 4 on seed 5; (4) `moveCostPerTile: 0`; (5) two players
on the same wall tile; (6) empty loot table with loot spawns (throws, as intended); (7)
snapshot and map byte sizes.

---

## Resolution Log

Work done after the audit was reviewed, in the plan's order. Every change landed as its own
commit with the full check suite green (`pnpm check`: typecheck, lint, format, tests) and
was verified as noted. Test count went from 155 to 195.

| Plan item | Finding                                                | Status                    | Commit / verification                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | C1 down survivor can hold the turn                     | **Fixed**                 | `requireActivePlayer` rejects non-standing senders (`PLAYER_NOT_ACTIVE`); end of round pauses on the first standing survivor; reassignment reacts to any ineligibility. Regression test from the reproduction; the suite-level replay test asserts the invariant on every state.                                                                                                                                             |
| 2         | H1 duplicate and stale commands                        | **Fixed**                 | `command.expectedVersion`, per-socket `seq` tracking, `DUPLICATE_COMMAND` / `STALE_STATE` errors carrying `seq`; protocol version 2; integration tests.                                                                                                                                                                                                                                                                      |
| 3         | H2 socket abuse limits                                 | **Fixed**                 | 16 KB payload cap, 200-connection cap, 30 s ping liveness, per-socket token bucket with `RATE_LIMITED`; `PORT` validated; tests for rate limit, oversized frame, pings.                                                                                                                                                                                                                                                      |
| 4         | H3 map in every update                                 | **Fixed**                 | `map` message once per socket; `update.state` without the map (about 2 KB); client store joins them; integration and store tests; browser smoke test.                                                                                                                                                                                                                                                                        |
| 5         | H4 unvalidated setup                                   | **Fixed**                 | `validateMatchSetup` runs inside `createInitialState`; every invariant listed in the audit is checked and tested.                                                                                                                                                                                                                                                                                                            |
| 6         | M4 ad hoc passability                                  | **Fixed**                 | `passabilityFor` and `canStandOn` in `rules/occupancy.ts`; movement and zombies use them; tests.                                                                                                                                                                                                                                                                                                                             |
| 7         | M1 extraction hard-coded at creation and in the client | **Fixed**                 | `ObjectiveSettings`, `createObjective`, `evaluateObjective`, `objectiveZoneTiles`, `objectiveProgress`; client wording in `ui/objectiveText.ts`; no client file reads extraction fields.                                                                                                                                                                                                                                     |
| 8         | M2 zombie type and speed hard-coded                    | **Fixed**                 | `movesPerPhase` on the definition, weighted spawn table on its own RNG stream, shared `pickWeighted`; tests.                                                                                                                                                                                                                                                                                                                 |
| 9         | M3 item types duplicated                               | **Fixed**                 | `ITEM_TYPES` runtime list in game-core drives the decoder and the HUD.                                                                                                                                                                                                                                                                                                                                                       |
| 10        | Documentation drift                                    | **Fixed, and more found** | The five listed drifts were corrected. The audit had missed that `docs/ARCHITECTURE.md`'s module tables, owner map, and roadmap were still at their Milestone 1 and 5 state: edits in Milestones 4, 6, and 7 had silently failed because their assertion errors were filtered out of the console. Those sections were rewritten from the code. The audit's statement that "everything else matched" was wrong on that point. |
| 11        | M10 timing-dependent server tests                      | **Fixed**                 | Injectable scheduler for the abandonment timer, a disconnect hook, and an ordering probe instead of sleeps.                                                                                                                                                                                                                                                                                                                  |
| 12        | Testing gaps                                           | **Fixed**                 | Added: C1 regression, duplicate/stale, `ClientStore`, `GameConnection` (fake socket, fake timers), suite-level random-play replay with snapshot resume, LOS symmetry, setup validation, passability, animation player, HTTP endpoints, socket limits, session takeover, map delivery.                                                                                                                                        |
| 13        | M6 asymmetric line of sight                            | **Fixed**                 | Both directions checked; 4x4 symmetry sweep test.                                                                                                                                                                                                                                                                                                                                                                            |
| 14        | M7 growing `applyCommand`                              | **Fixed**                 | One handler file per concern under `commands/handlers/`.                                                                                                                                                                                                                                                                                                                                                                     |
| 15        | M8 `BoardRenderer` mixed concerns                      | **Fixed**                 | `AnimationPlayer` behind an `AnimationStage` interface, unit-tested with a recording stage; renderer keeps drawing and reconciliation.                                                                                                                                                                                                                                                                                       |
| 16        | M11 reconnect UX and superseded tabs                   | **Fixed**                 | `SESSION_REPLACED` sent and old socket closed; the client keeps the match view while reconnecting and stops competing for a replaced slot.                                                                                                                                                                                                                                                                                   |
| 17        | L3 app-level lint boundaries                           | **Fixed**                 | Client cannot import `ws` or the server; server cannot import Phaser or the client; verified with probe files.                                                                                                                                                                                                                                                                                                               |
| 18        | L7, L8 deployment basics                               | **Done**                  | esbuild server bundle, `/healthz`, static serving of the client on the same port, JSON-line logging, graceful shutdown, Dockerfile. The bundle was run under plain Node and exercised over HTTP and WebSocket; the Docker image was not built here (no daemon in the audit environment).                                                                                                                                     |
| –         | M5 player cap vs spawn count                           | **Fixed**                 | The server asks the generator for exactly one spawn per player; `MAX_PLAYERS` is the single cap.                                                                                                                                                                                                                                                                                                                             |
| –         | L4 unnamed timeout                                     | **Fixed**                 | `REJECTION_MESSAGE_MS`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| –         | M9 `ServerMatch` breadth, sentinel host id             | Open                      | Acceptable as the room object for now; revisit when lobby features are added.                                                                                                                                                                                                                                                                                                                                                |
| –         | M12 no persistence                                     | Open by decision          | Documented in README; state is plain JSON if snapshot-to-disk is wanted later.                                                                                                                                                                                                                                                                                                                                               |
| –         | L1, L2, L5, L6, L9, L10, L11                           | Open by decision          | Lint relaxations are deliberate; the server-message cast is documented trust; the unused `rng` parameter is the documented seam; the Phaser chunk size is inherent; match-code enumeration is covered by the rate limit; unbounded reserve ammo is a balance choice; name length in code units is cosmetic.                                                                                                                  |

Readiness after this work: additional weapons, zombies, and items remain data-only; a
second game mode now touches only objective files and the wording module; larger maps are
no longer blocked by snapshot size; public multiplayer testing is unblocked from the
engineering side (sequencing, limits, takeover, reconnect) and should start behind a
TLS-terminating proxy; deployment has a runnable bundle and container definition, with
in-memory matches as the remaining known limitation.
