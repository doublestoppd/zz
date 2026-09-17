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
   validation result, then add a `case` in `commands/applyCommand.ts` that calls
   `requireActivePlayer`, the rule, and returns the new state and events.
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
`packages/map-generation/src/templates/buildings.ts` (`#` wall, `.` interior, `+` door, and a
space for "leave the ground alone"). Put at least one door on the bottom edge; rotation
supplies the other orientations. The placer picks any template that fits a lot, so small
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
2. `packages/game-data/src/zombies.ts`: the compiler now demands a `ZombieDefinition` entry.
3. Spawning: `map/asciiMap.ts` currently spawns every `Z` as a `walker`; add a legend symbol
   or a spawn table if the new type needs its own placement.
4. Behaviour that differs per type should be data first (`ZombieDefinition` fields read in
   `zombies/targetSelection.ts` and `zombies/zombiePhase.ts`). Only add a `switch` on the type
   when a number or flag cannot express the difference.
5. `apps/client/src/render/BoardRenderer.ts`: a colour or label per type if wanted.
6. Tests in `zombies/*.test.ts` using an ASCII layout with `Z` markers.

## Add a weapon

1. `packages/game-core/src/state/types.ts`: extend `WeaponType`.
2. `packages/game-data/src/weapons.ts`: the compiler demands a `WeaponDefinition` entry
   (damage, range, magazine size, action point costs).
3. Nothing else, if the weapon behaves like the pistol. Behaviour that differs (spread,
   burst, melee) is a new field on `WeaponDefinition` read in `rules/combat.ts`, not a
   `switch` on the type, unless a number or flag cannot express it.
4. Giving it to a survivor: `startingWeapon` in `packages/game-data/src/survivors.ts` until
   the inventory milestone adds pickup.

## Add an item

1. `packages/game-core/src/state/types.ts`: extend `ItemType`.
2. `packages/game-data/src/items.ts`: the compiler demands an `ItemDefinition` (an effect
   and an action point cost). Add a weight to `LOOT_TABLE` if it should appear as loot.
3. `packages/protocol/src/decodeClientMessage.ts`: add the name to `ITEM_TYPES` so
   `use_item` accepts it.
4. `apps/client/src/render/BoardRenderer.ts` (`ITEM_LABELS`) and `apps/client/src/ui/Hud.ts`
   (the use-button list): the compiler flags the first, the second is a two-line entry.
5. If the item needs a new kind of effect, add a member to `ItemEffect` in
   `state/definitions.ts`; `applyUseItem` in `commands/applyCommand.ts` and
   `validateUseItem` in `rules/items.ts` switch on it and will not compile until handled.

## Change where loot appears

`placeLoot` in `packages/map-generation/src/city.ts` chooses spawn tiles;
`DEFAULT_CITY_OPTIONS.lootSpawns` sets how many. For the test map, add `L` markers in
`packages/game-core/src/map/testMaps.ts`.

## Add a network message

1. `packages/protocol/src/messages.ts`: add the interface to `ClientMessage` or `ServerMessage`.
2. Client → server: add a `case` in `decodeClientMessage.ts` and a test.
   Server → client: add the `t` literal to `SERVER_MESSAGE_TYPES` in `decodeServerMessage.ts`.
3. `apps/server/src/router.ts`: route it. `ServerMatch` or `MatchRegistry` implements it.
4. `apps/client/src/state/ClientStore.ts`: handle it in `applyServerMessage`.
5. NETWORK-PROTOCOL.md: document direction, payload, validation, and responses.

## Add a game mode or change the objective

1. `packages/game-core/src/state/types.ts`: add a member to the `ObjectiveState` union with
   its own `kind` and settings.
2. `packages/game-core/src/objectives/`: a pure `evaluate<Mode>(state)` returning the new
   objective state, an optional outcome, and events (see `extraction.ts`).
3. `packages/game-core/src/turn/phases.ts`: dispatch on `state.objective.kind` in
   `resolveEndOfRound`. Keep the defeat check first.
4. `packages/game-data/src/objectives.ts`: default settings.
5. `apps/client/src/ui/Hud.ts`: the objective line and outcome text.
6. Tests in `objectives/*.test.ts`; GAME-RULES.md.

Do not build a generic quest or scripting engine for this; one function per mode is the
intended shape until a third mode proves otherwise.

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

An `update` message contains the full `GameState`, including `rngState`. Paste it into a
test as the starting state, apply the commands that followed, and assert. That state and
command list is a complete, deterministic reproduction.

## Where things are forbidden

- Phaser, `ws`, DOM, or app code inside `packages/*`.
- `any`. If unavoidable, document why in a comment on that line.
- Deep imports (`@zombie/game-core/src/...`).
- Trusting a client field for an outcome (position, AP, target death, and so on).

## Adding a package

Create `packages/<name>/package.json` with `"exports": { ".": "./src/index.ts" }`, a
`tsconfig.json` extending the base, and add the dependency edge to `docs/ARCHITECTURE.md`.
Vitest picks it up through `projects: ["packages/*", "apps/*"]`.
