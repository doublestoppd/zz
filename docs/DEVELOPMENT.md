# Development guide

How a human changes things. Each recipe names the files to touch; if a change needs more
than these, the architecture may need a new decision record.

## Everyday commands

```sh
pnpm dev             # server + client with hot reload
pnpm test            # every package's tests
pnpm test:watch      # Vitest in watch mode
pnpm typecheck && pnpm lint && pnpm format:check
pnpm check           # all checks; run before committing
```

Tests sit next to the code as `*.test.ts`. Game-core tests build states with
`packages/game-core/src/testing/makeTestState.ts` and assert on `applyCommand` results.

## Add a player command

1. `packages/game-core/src/commands/types.ts`: add an interface and add it to `PlayerCommand`.
2. `packages/game-core/src/commands/rejection.ts` (or a new `rules/*.ts` reason union): add
   any new rejection reasons.
3. Implement the rule as a pure function in `packages/game-core/src/rules/` returning a
   validation result, then write a handler in `commands/handlers/` that calls
   `requireActivePlayer`, the rule, and returns the new state and events, and add its `case`
   to the switch in `commands/applyCommand.ts`.
4. `packages/game-core/src/events/types.ts`: add the event(s) the command produces.
5. `packages/protocol/src/decodeClientMessage.ts`: add a `case` to `decodeClientCommand`
   validating every field. `ClientCommand` updates itself from `PlayerCommand`.
6. `apps/client/src/ui/rejectionMessages.ts`: the compiler will demand text for new reasons.
   `apps/client/src/ui/eventLog.ts`: same for new events.
7. Client input: add an intent function under `apps/client/src/input/` and wire it in the
   scene or HUD.
8. Tests: rule tests in game-core, a decode case in protocol, a server integration case if
   the network behaviour is new.
9. Docs: GAME-RULES.md (the rule), NETWORK-PROTOCOL.md (the payload).

## Change a rule number (AP, health, move cost)

`packages/game-data/src/survivors.ts` or `rules.ts`. Nothing else. If a value is not there,
it should be: move it out of code into game-data and pass it through `GameRules` or
`MatchSetup`.

## Add a building template

Append an ASCII footprint to `BUILDING_TEMPLATES` in
`packages/map-generation/src/templates/buildings.ts` (`#` wall, `.` interior, `+` closed
door, `k` locked door, `w` window, `c` container, and a space for "leave the ground alone").
Put at least one door on the bottom edge; rotation supplies the other orientations. Doors
and windows become barrier entities automatically (`placeBuilding` in `city.ts`). The placer picks any template that fits a lot, so small
templates are used most often. Run the map-generation tests: the 200-seed validation loop
will catch a template that seals its own door.

## Change how the city is generated

Knobs (road width, block size range, lot size, building chance, zombie distance) are the
constants at the top of `packages/map-generation/src/city.ts`; the per-match size and counts
are `DEFAULT_CITY_OPTIONS`. Each placement step is its own function in that file. Keep every
random choice on the `rng` parameter and finish with `validateLayout`; add a validation rule
there rather than a guard in the generator when a new invariant matters to gameplay.

To view a seed: write a short script that calls `generateCity` and prints each tile's type
with markers for spawns, extraction, and zombies (see `city.test.ts` for the shape).

## Add a tile type

1. `packages/game-core/src/map/types.ts`: extend `TileType` and add its row to `TILE_DEFINITIONS`.
2. `packages/game-core/src/map/asciiMap.ts`: add a legend symbol if hand-authored maps need it.
3. `apps/client/src/render/BoardRenderer.ts`: choose a colour.

## Change the test map

Edit the ASCII rows in `packages/game-core/src/map/testMaps.ts`. Keep at least four `S`
spawns. Server integration tests depend on its spawn positions. Game-core tests use their
own layout in `testing/makeTestState.ts`.

## Add a zombie type

1. `packages/game-core/src/state/types.ts`: extend `ZombieType`.
2. `packages/game-data/src/zombies.ts`: the compiler now demands a `ZombieDefinition` entry
   (health, damage, `movesPerPhase`, `sightRange`, and the optional flags `slow` and
   `unshakable`). Add a weight to `ZOMBIE_SPAWN_TABLE` so it appears at
   spawns; the type at each `Z` is rolled from that table on the `zombieSpawns` RNG stream.
3. Behaviour that differs per type should be data first: a number or a flag on
   `ZombieDefinition`, read at one extension point (`slow` in `zombies/zombiePhase.ts`,
   `unshakable` in `rules/combat.ts`, `sightRange` in `zombies/targetSelection.ts`). Never
   `switch` on the type in the rules; compose flags instead.
4. `apps/client/src/render/BoardRenderer.ts` (`ZOMBIE_STYLE`): the compiler demands a
   label, colour, and size for the new type.
5. Tests in `zombies/*.test.ts` using an ASCII layout with `Z` markers.

## Add a weapon

1. `packages/game-core/src/state/types.ts`: add the name to `WEAPON_TYPES` and to
   `ITEM_TYPES` (a weapon is found and swapped as a ground item).
2. `packages/game-data/src/weapons.ts`: the compiler demands a `WeaponDefinition`, either
   `kind: "firearm"` (damage, range, action points, noise, ammunition kind, magazine,
   reload cost, optional `damageByDistance` falloff) or `kind: "melee"` (damage, range 1,
   action points, noise, optional `knockback`). `packages/game-data/src/items.ts` demands
   the matching `{ kind: "weapon", weaponType }` item; add it to a loot or search table so
   it appears.
3. `apps/client/src/render/BoardRenderer.ts` (`ITEM_LABELS`) and `apps/client/src/ui/Hud.ts`
   (`ITEM_USE_LABELS`): the compiler flags both.
4. Nothing else if the numbers express the weapon. Behaviour a number cannot express is a
   new optional field on the definition, read in one place in `rules/combat.ts`
   (`damageAtDistance`, `knockbackDestination` are the examples), never a `switch` on the
   weapon type. A new ammunition kind is an entry in `AMMO_TYPES` plus an item that adds to
   it; the reserve record, HUD, and validation follow from the union.
5. Tests in `rules/weapons.test.ts` using one-row layouts: range, action points, ammo,
   noise, and the special rule.

## Add an item

1. `packages/game-core/src/state/types.ts`: add the name to the `ITEM_TYPES` array; the
   `ItemType` union, the protocol decoder, and the HUD button list all derive from it.
2. `packages/game-data/src/items.ts`: the compiler demands an `ItemDefinition` (an effect
   and an action point cost; an `ammo` effect names its ammunition kind). Add a weight to
   `LOOT_TABLE` or a search table if it should appear as loot.
3. `apps/client/src/render/BoardRenderer.ts` (`ITEM_LABELS`) and `apps/client/src/ui/Hud.ts`
   (`ITEM_USE_LABELS`): the compiler flags both.
4. If the item needs a new kind of effect, add a member to `ItemEffect` in
   `state/definitions.ts`; `applyUseItem` in `commands/handlers/items.ts` and
   `validateUseItem` in `rules/items.ts` switch on it and will not compile until handled.
   An item that is spent by another command rather than used on its own (the key, spent by
   `open_door`) gets an effect kind that `validateUseItem` refuses and a check in that
   command's rule (`carriesKey` in `rules/barriers.ts`).

## Add a loot table or container category

1. `packages/game-core/src/state/types.ts`: add the name to `CONTAINER_CATEGORIES`.
2. `packages/game-data/src/containers.ts`: the compiler demands a `SearchLootTable` for it
   (`minRolls`, `maxRolls`, weighted entries; use `"nothing"` entries for sparse places).
3. `packages/map-generation/src/templates/buildings.ts`: give a template that category, and
   mark container cells with `c` in its rows. The generator collects them; nothing else
   changes. Hand-authored maps use `C` (always "home").
4. Tune search cost with `searchActionPointCost` in `packages/game-data/src/rules.ts`.
5. Tests: `rules/search.test.ts` rolls from every category; add a case for the new one.

## Change where loot appears

`placeLoot` in `packages/map-generation/src/city.ts` chooses spawn tiles;
`DEFAULT_CITY_OPTIONS.lootSpawns` sets how many. For the test map, add `L` markers in
`packages/game-core/src/map/testMaps.ts`.

## Test with several clients locally

Run `pnpm dev` and open `http://localhost:5173` in two or more tabs (or browsers): create
in one, join with the code in the others. A refresh of any tab rejoins the same slot
through the token in `sessionStorage`; opening the same match in a second tab of the same
browser profile takes the slot over (`SESSION_REPLACED` in the first). For scripted
clients use `ProtocolClient` (`apps/server/src/testing/protocolClient.ts`): a `ws` socket,
the protocol encoder, `command(...)` with automatic ids and revisions, and `next(type)` to
await an answer.

## Integration tests and the soak

The server's integration tests start the real listener on an ephemeral port and drive it
with `ProtocolClient`s (`createServerHarness` in `apps/server/src/testing/harness.ts`:
fresh registry per test, fixture map, fixed seed, manual abandonment timer, `lobbyOf(n)`
and `matchOf(n)` helpers). `server.test.ts` covers single-client protocol behaviour;
`multiplayer.test.ts` covers party sizes 1-4, the fifth player, simultaneous input,
ordering, whole-party disconnects, and terminal matches. Anything that crosses the socket
belongs in one of these, not in a unit test with fakes.

The soak (`apps/server/src/soak/`) plays whole matches with greedy bots over real sockets
against generated cities:

```
pnpm --filter @zombie/server soak -- --matches 200 --seed 1 --chaos
pnpm --filter @zombie/server soak -- --seed 32 --matches 1 --players 4 --chaos
```

Each match is deterministic from its seed (city, simulation, and the chaos schedule:
socket drops with rejoin, duplicate and stale-revision probes, a terminal rejoin). Every
snapshot every bot receives is checked (`baseInvariants` in `runSoak.ts`, plus whatever
`invariants` a caller passes; game-core's own checks plug in here), and all bots must see
the same view at the same revision. A failing seed is written to `soak-failures/` (or
`--failures DIR`) as `<seed>-<players>p.journal.json`, which the replay CLI accepts, and
`<seed>-<players>p.failure.json` with the reason and the exact rerun command. Bot rule
rejections are expected (bots plan from a fog-of-war view) and are answered by ending the
turn; every other rejection of a bot's own command fails the match. `soak.test.ts` runs
eight chaos matches in the normal suite; the CI nightly job runs hundreds.

## Replay a match

Every finished match's journal (`MatchJournal` from game-core: metadata, initial
checkpoint, and every accepted mutation with its revision and checkpoint) is written to
`JOURNAL_DIR/<matchId>-<seed>.json` when `JOURNAL_DIR` is set; `ServerMatch.journal()`
returns it in process. Verify one with:

```
pnpm --filter @zombie/server replay path/to/QMCN-2878312633.json
```

The verdict is one JSON line: `ok` with the final checkpoint, or the first divergence
(`INITIAL_STATE_MISMATCH`, `COMMAND_REJECTED`, `CHECKPOINT_MISMATCH` with the revision), or
`UNSUPPORTED_SIMULATION_VERSION`. Commands are the source of truth; events are derived
([ADR 0008](adr/0008-match-journal-and-replay.md)). `apps/server/src/replay/verifier.ts`
rebuilds the initial state from the journal's metadata and this build's rule tables.

## Version bump rules

- `SIMULATION_VERSION` (`packages/game-core/src/version.ts`): bump when a change alters
  what a recorded command sequence does: a rule, RNG consumption, phase order, tie-break,
  generation, or setup. Not for presentation, logging, or protocol changes. Journals from
  other versions are refused, never replayed.
- `PROTOCOL_VERSION` (`packages/protocol/src/messages.ts`): bump on any change to a
  message contract an already-loaded client could get wrong. A protocol bump does not
  imply a simulation bump, nor the reverse.
- `GAME_VERSION` (`apps/server/src/version.ts`, from the `GAME_VERSION` environment
  variable at build or start): the human-facing release label; recorded in journals.

## Diagnose a stale-state or duplicate rejection

Every command answer is logged by the server as one JSON line (`command accepted` or
`command rejected`) with `matchCode`, `playerId`, `commandId`, `type`, `reason`, `detail`,
and `revision`; a client bug report only needs the command id. `STALE_REVISION` means the
client composed the command against a revision the server had already moved past: look
for the `update` (with its own `commandId`, or none for a presence change) between the
client's last applied revision and the server's `currentRevision`. The browser client
answers it by sending `resync` and rebuilding from the snapshot. `DUPLICATE_COMMAND` means
the same id was seen within the player's last 256 commands; the client's original outcome
was already broadcast. Reproduce either with a raw socket: send two `command` messages
with the same `commandId`, or one whose `baseRevision` is the previous revision. On a
running server, `curl -H "Authorization: Bearer $ADMIN_TOKEN" :8080/admin/matches/<CODE>`
shows the current revision, round, and phase without touching the match, and
`curl :8080/metrics | grep zombie_commands_total` shows how often each reason occurs.

## Add a network message

1. `packages/protocol/src/messages.ts`: add the interface to `ClientMessage` or `ServerMessage`.
2. Client → server: add a `case` in `decodeClientMessage.ts` and a test.
   Server → client: add the `t` literal to `SERVER_MESSAGE_TYPES` in `decodeServerMessage.ts`.
3. `apps/server/src/router.ts`: route it. `ServerMatch` or `MatchRegistry` implements it.
4. `apps/client/src/state/ClientStore.ts`: handle it in `applyServerMessage`.
5. NETWORK-PROTOCOL.md: document direction, payload, validation, and responses.

## Add a scenario or an objective primitive

1. A scenario that only sequences existing primitives is data: add the name to
   `SCENARIO_TYPES` in `packages/game-core/src/state/types.ts`; the compiler demands an
   entry in `packages/game-data/src/scenarios.ts` (name, description, steps) and a line in
   the client's `describeOutcome`. The lobby select and the protocol decoder derive from
   the list. If it needs an item, give it an `objective` effect in `items.ts`; the map
   generator already places one item per `acquire_item` step at its objective spawns
   (raise `objectiveSpawns` in `DEFAULT_CITY_OPTIONS` for more).
2. A new primitive is a member of `ObjectiveStepSettings` (`state/definitions.ts`) and of
   the runtime `ObjectiveStep` (`state/types.ts`), a case in `createStep`
   (`objectives/objective.ts`) and in `evaluateStep` and `stepZone` (`objectives/steps.ts`),
   a check in `validateSetup.ts`, and a line in `apps/client/src/ui/objectiveText.ts`.
   The exhaustive switches list every other place.
3. A new location reference extends `LocationRef` and `resolveLocation`; the layout must
   provide its tiles (`map/asciiMap.ts` legend, `map-generation/src/city.ts`) and the
   layout validator must check they are reachable.
4. Tests in `objectives/objectives.test.ts`: sequence progression, wrong order, completion,
   and a layout that cannot host the scenario.

## Animate or voice a new event

1. `apps/client/src/render/animationPlan.ts`: add a `case` for the event in `planAnimations`
   returning `move`, `shot`, `flash`, `vanish`, or `sound` steps (or add a new step kind and
   handle it in `BoardRenderer.playSteps`). The switch is exhaustive, so a new event type
   will not compile until it is listed, even if it maps to nothing.
2. For a new sound, add the name to `SoundName` and its tones to `TONES` in
   `apps/client/src/audio/SoundPlayer.ts`. Sounds are synthesized; there are no audio files.
3. Add a case to `animationPlan.test.ts`; it runs without Phaser.

## Change door rules or add a barrier kind

1. Movement and vision effects live in `packages/game-core/src/state/barriers.ts`
   (`barrierBlocksMovement`, `barrierBlocksVision`); every pathfinding call goes through
   `passabilityFor` and every sight check through `hasLineOfSight`, so changing those two
   functions changes survivors, zombies, and shooting alike.
2. Interactions are validated in `rules/barriers.ts` (`validateOpenDoor`,
   `validateCloseDoor`, `validateForceEntry`) and applied in
   `commands/handlers/barriers.ts`; costs and the forced-entry noise are `GameRules`
   numbers in `packages/game-data/src/rules.ts`, checked by `validateSetup.ts`.
3. A new kind extends `BarrierKind` in `state/types.ts`; the `TileType` for its opening,
   the ASCII legend (`map/asciiMap.ts`), the template legend
   (`map-generation/src/templates/buildings.ts`), the layout validator, and the client's
   `createBarrierSprite` in `BoardRenderer.ts` then need a case. Keep windows' "never block
   vision" and doors' "opaque when shut" as data on the kind if a third kind blurs them.
4. Letting zombies interact (break doors) belongs in `zombies/targetSelection.ts` as a
   decision kind, not in passability: a zombie that plans through a door must pay for it.
5. Tests: `rules/barriers.test.ts` covers movement, sight, pathfinding, locked-state
   rejections, and action point costs with one-row corridors.

## Change what the team can see

The view is `visibleTiles` in `packages/game-core/src/rules/visibility.ts` (range from
`GameRules.visionRange`, sight from `hasLineOfSight`, so doors and windows already count).
`revealExplored` folds it into `state.explored` at the end of `applyCommand`. What leaves
the server is decided in `apps/server/src/match/redact.ts`: add a case there for any new
event that carries a zombie position, or the position leaks. The client paints the answer
in `BoardRenderer.drawFog` and must never decide visibility itself. Tests:
`rules/visibility.test.ts` and the redaction test in `apps/server/src/server.test.ts`.

## Add a dynamic event

1. Add the name to `DYNAMIC_EVENT_TYPES` in `packages/game-core/src/state/types.ts` and a
   pool entry (weight, `minThreat`) plus any numbers it needs to
   `packages/game-data/src/dynamicEvents.ts` (`DynamicEventRules` in
   `state/definitions.ts` if a new number is needed, checked in `validateSetup.ts`).
2. Add a case to `fire` in `rules/dynamicEvents.ts` that calls an existing system
   (`makeNoise`, `spawnWave`, ground items, a barrier change, an objective step) and returns
   the events that system emits. Never invent a parallel mechanic for an event.
3. The client log (`EVENT_LABELS` in `ui/eventLog.ts`) and the animation plan are records
   over the type, so the compiler demands their entries.
4. Tests in `rules/dynamicEvents.test.ts` with `chancePerLevel` forced to 100.

## Change how pressure escalates

Everything is in `packages/game-data/src/threat.ts`: rounds and heat per level, the wave
size and interval per level, the spawn table per level, and the keep-away distance. A new
threat input is one more term in `computeThreat` (`rules/threat.ts`); a new effect of a
level belongs next to `applyThreat`, reading existing systems (spawning, noise) rather
than inventing a penalty. `setup validation` checks the per-level arrays have
`maxLevel + 1` entries. Tests in `rules/threat.test.ts` use `makeTestState({ threat })` to
override the slow test defaults.

## Add a specialty or a new specialty effect

1. A new specialty that only combines existing modifiers is data: add the name to
   `SPECIALTY_TYPES` in `packages/game-core/src/state/types.ts` and the compiler demands
   an entry in `packages/game-data/src/specialties.ts` (name, one-line description shown
   in the lobby, modifiers). The lobby select, decoder, and HUD derive from the list.
2. A new kind of effect is a field on `SpecialtyModifiers` (`state/definitions.ts`, integer,
   0 means no change) plus exactly one read through `modifiersOf` at the rule it changes
   (`discounted` for costs). Never branch on the specialty name in a rule.
3. Tests in `rules/specialties.test.ts`: the effect, and that every specialty can still
   perform every baseline action.

## Add a noise source or change what zombies notice

1. A new loud action calls `makeNoise(state, position, intensity, sourceType)` from
   `packages/game-core/src/rules/noise.ts` inside its command handler (see
   `commands/handlers/combat.ts` and `handlers/search.ts`) and appends the returned events.
   Put the intensity in game data (a `WeaponDefinition.noise` field, `GameRules.searchNoise`)
   rather than in the handler, and add a `validateSetup.ts` check for it.
2. A new `sourceType` extends `NoiseSourceType` in `state/types.ts`; the client log
   (`NOISE_LABELS` in `ui/eventLog.ts`) and the board marker colour (`NOISE_COLOURS` in
   `render/BoardRenderer.ts`) are records over it, so the compiler demands an entry.
3. Hearing and preference live in `rules/noise.ts` (`canHear`, `noiseScore`); sight in
   `zombies/targetSelection.ts` (`canSee`, reading `ZombieDefinition.sightRange`). The
   priority order (attack, pursue, investigate, wait) is `decideZombieAction`.
4. Decay happens once per zombie phase in `turn/phases.ts` via `decayNoises`;
   `GameRules.noiseDurationRounds` sets how many phases a noise lasts.
5. Tests: `zombies/noise.test.ts` uses small ASCII corridors with a wall between the
   survivor and the zombie so sight and hearing can be told apart.

## Add a keyboard shortcut

`keyToCommand` in `apps/client/src/input/keyboard.ts` maps a key to a command using the same
rule helpers as clicks. Add the key there and a line to `KEY_HELP`; test in `keyboard.test.ts`.

## Add a phase or change the turn sequence

`packages/game-core/src/state/types.ts` (`GamePhase`) and `turn/phases.ts`. Keep transitions
as pure functions that return `{ state, events }`, and keep `advanceUntilPlayerInput` the
only loop. Update GAME-RULES.md.

## Use randomness in a rule

Take `rng: Rng` as a parameter. Do not call `Math.random` (lint will reject it). The phase
function that owns the call must write `rng.getState()` back into `state.rngState`; see
`resolveZombiePhase` for the pattern. Add a determinism test: run the same commands twice
from the same state and `expect(a).toEqual(b)`.

## Reproduce a bug from a match

A soak failure gives you the seed: rerun it with the command in its `.failure.json`, or
replay its journal (`pnpm --filter @zombie/server replay soak-failures/<seed>-<n>p.journal.json`).

An `update` message contains the full `GameState`, including `rngState`. Paste it into a
test as the starting state, apply the commands that followed, and assert. That state and
command list is a complete, deterministic reproduction.

## Add an invariant

When a rule introduces a new assumption ("a survivor never carries two keys", "a barrier
is never `open` on a window tile"), add the check to `checkInvariants` in
`packages/game-core/src/state/invariants.ts` with a stable `InvariantCode` (extend the
union) and a `detail` naming the entity, and decide its level: `critical` only if letting
play continue would break a rule on the board (position, occupancy, numbers, turn), `full`
otherwise. Add a case to `state/invariants.test.ts` that corrupts a state and expects the
code, and confirm the random play and the soak stay clean (`pnpm check`). Nothing else
changes: the runtime, the replay verifier, and the soak all call the same function.

## Where things are forbidden

- Phaser, `ws`, DOM, or app code inside `packages/*`.
- `any`. If unavoidable, document why in a comment on that line.
- Deep imports (`@zombie/game-core/src/...`).
- Trusting a client field for an outcome (position, AP, target death, and so on).

## Adding a package

Create `packages/<name>/package.json` with `"exports": { ".": "./src/index.ts" }`, a
`tsconfig.json` extending the base, and add the dependency edge to `docs/ARCHITECTURE.md`.
Vitest picks it up through `projects: ["packages/*", "apps/*"]`.
