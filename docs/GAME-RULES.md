# Game rules (as implemented)

This document describes current behaviour only. Where a rule is owned by a specific file,
that file is named so the rule can be changed in one place.

## Match setup

- 1–4 players. Each player is assigned a spawn tile in join order (`state/createInitialState.ts`).
- The map is generated from the match seed (`packages/map-generation`): a 26x18 city with a
  road grid, blocks of buildings with doors, four survivor spawns together on the western
  road, a 2x2 extraction zone as far from the spawns as the streets allow, five walkers
  spawned at least a third of the longest path away, and six loot spawns on open ground
  inside buildings where possible. Tile types: `floor` and `road` (walkable, see-through),
  `wall` (neither), and the openings `door` and `window`, each holding a barrier entity
  whose state decides whether it can be passed or seen through (see Doors and windows).
  Zombies and the extraction zone are always placed outdoors, reachable without passing a
  door or window. The same seed always produces the same city.
- Tests use the hand-authored fixture `SMALL_TEST_MAP` (`map/testMaps.ts`) instead.
- Every survivor starts with the values in `packages/game-data/src/survivors.ts`
  (10 health, 4 action points) and full action points.
- The zombie type at each spawn is rolled from the weighted spawn table in
  `packages/game-data/src/zombies.ts` on its own RNG stream (walker 6, runner 2, brute 1).
  Types differ only by numbers and two behaviour flags (see Zombie phase):

  | Type   | Health | Damage | Moves per phase | Sight | Flags                                            |
  | ------ | ------ | ------ | --------------- | ----- | ------------------------------------------------ |
  | walker | 3      | 2      | 1               | 6     |                                                  |
  | runner | 2      | 1      | 2               | 8     |                                                  |
  | brute  | 8      | 4      | 1               | 5     | `slow` (steps in even rounds only), `unshakable` |

- Every survivor carries the starting weapon from `packages/game-data/src/survivors.ts`
  (a pistol with a full magazine), 12 rounds of reserve ammunition, and an empty inventory
  with room for 3 items.
- Each loot spawn on the map holds one ground item whose type is rolled from the weighted
  loot table in `packages/game-data/src/items.ts` (bandage 2 : medkit 1 : ammo box 2) using
  the `loot` Rng stream, so the same seed always yields the same loot. Most supplies come
  from searching containers instead (see Scavenging).
- The match seed is chosen by the server. Gameplay randomness (none consumed yet) comes
  from an Rng whose cursor is stored in `GameState.rngState`.

## Fog of war (`rules/visibility.ts`)

- **Visible**: every tile within `visionRange` (8, Chebyshev) of any survivor on the board
  with a clear line of sight from that survivor, by the same rule shooting uses (walls and
  shut doors block; windows, open doors, survivors, and zombies do not). Down and
  disconnected survivors still see from where they lie.
- **Explored**: every tile that has ever been visible, plus the tiles every scenario step
  names (the briefing). Stored in the state as a grid, never forgotten, and **shared by the
  whole team**: the design choice for this version is one team map rather than per-player
  bookkeeping.
- **Unexplored**: everything else, blacked out on the client. Explored-but-not-visible tiles
  are dimmed: the terrain, doors, items, and cabinets drawn there are what the team last
  knew; only the current view is live.
- The server sends every client the same redacted snapshot: zombies outside the current
  view are left out, and zombie events (`zombie_moved`, `zombie_knocked_back`,
  `zombie_investigating`, `zombie_spawned`) whose position is out of view are dropped, so
  a hidden zombie's position never reaches a client. Players, items, doors, noises, the
  threat level, and the explored grid are always sent. The client recomputes the current
  view from the snapshot with the same function; it owns no visibility rule.
- Visibility updates after every command and phase (moving, opening or closing a door,
  a zombie phase that moves survivors' surroundings), because the explored grid is
  refreshed on the settled state after each accepted command.

## Threat and pacing (`rules/threat.ts`)

Pressure rises on a schedule everyone can read. At the end of every round, after the
objective is judged, the threat level is recomputed as the sum of three whole numbers,
capped at `maxLevel` (4):

- **time**: `floor(round / roundsPerLevel)`, so with `roundsPerLevel` 4 the first four
  rounds are level 0 from time alone;
- **noise**: `floor(heat / heatPerLevel)`, where `heat` is the sum of every noise
  intensity made so far (40 per level: five pistol shots, or a shotgun blast plus a
  forced window);
- **objective**: one level per completed scenario step.

A change emits `threat_changed` and the HUD names the level (quiet streets, stirring,
restless, swarming, overrun). At level 1 and above, reinforcement waves arrive:
`reinforcementCount[level]` zombies every `reinforcementInterval[level]` rounds (level 1:
one every 3 rounds; 2: one every 2; 3: two every 2; 4: two every round), each rolled from
the level's own spawn table (runners and brutes grow more common) and placed on a free
zombie spawn at least `spawnMinDistance` (4) tiles from every standing survivor. A wave
draws from the gameplay RNG, so it replays; it is judged after the objective, so it can
never spoil a win. Numbers live in `packages/game-data/src/threat.ts`.

## Dynamic events (`rules/dynamicEvents.ts`)

At the end of every round, after the threat level is judged, one dynamic event may fire.
The chance is `chancePerLevel[threat]` percent (0 at level 0, then 15, 25, 35, 45); no
event fires within `minRoundsBetween` (2) rounds of the last; the event is drawn by
weight from the pool entries whose `minThreat` the level meets. The draw uses the gameplay
RNG, so a seed replays its events. Every event is made of systems that already exist:

| Event          | What happens                                                                                         | Built from            |
| -------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| `car_alarm`    | a noise of intensity 15 lasting 3 zombie phases at one of the zombie spawns; zombies converge on it  | noise + investigation |
| `horde`        | up to 3 zombies from the current level's spawn table on free spawns out of sight (level 2 and above) | threat waves          |
| `supply_cache` | 2 items from the cache table dropped on a free tile 3 to 7 tiles from a survivor                     | ground loot           |

Each emits `dynamic_event` (with the position when it has one) followed by the ordinary
events of its substance (`noise_made`, `zombie_spawned`, `item_dropped`), so the log and
the board explain it without special cases. Numbers live in
`packages/game-data/src/dynamicEvents.ts`; balance in [BALANCE.md](BALANCE.md).

## Specialties (`rules/specialties.ts`)

Each player picks a specialty in the lobby (default `survivor`, no bonus). A specialty is
a set of whole-number modifiers in `packages/game-data/src/specialties.ts`, each read at
one extension point; every survivor can still do everything, and no specialty is needed
to finish the extraction scenario.

| Specialty | Effect                                                               | Read in                     |
| --------- | -------------------------------------------------------------------- | --------------------------- |
| paramedic | bandages and medkits heal 2 more                                     | `use_item` heal             |
| officer   | reloading costs 0 AP instead of 1                                    | `validateReload`            |
| mechanic  | forced entry costs 1 AP instead of 2 and its noise is 3 instead of 6 | `validateForceEntry`        |
| athlete   | 5 action points a turn instead of 4                                  | match creation              |
| scavenger | searching costs 1 AP instead of 2 and draws one extra item           | `validateSearch`, loot roll |

The scavenger's extra draw comes after the container's fixed sequence, so a scavenger
finds everything anyone else would have found in that cabinet, plus one more roll.
Discounts never take a cost below zero.

## Turn sequence

```
round N:  player_turn(first eligible) -> player_turn(next eligible) -> ... -> zombie_phase -> end_of_round
round N+1: ...
```

- Turn order is fixed at match start in join order (`GameState.turnOrder`).
- A player is **eligible** to act while `present` is true and `status` is `active`
  (`turn/turnOrder.ts`). A later milestone adds "not extracted".
- A turn ends only when the active player sends `end_turn`, or when the active player
  becomes absent while someone else is present. Reaching zero action points does **not**
  end the turn.
- After the last eligible player, the zombie phase runs (`turn/phases.ts`, see below).
- End of round, in this order:
  1. If every survivor is down the match ends in **defeat**.
  2. The scenario's current objective step is evaluated (below) and may end the match in **victory**.
  3. Otherwise the round counter increases, every player's action points are refilled to
     their maximum, and the first eligible player in turn order becomes active.
- In the `finished` phase no further commands are accepted.

## Presence

- When a player disconnects they become absent. If they were active and anyone else is
  present, their turn ends immediately. If nobody else is present, they remain the active
  player and the match is paused.
- When any player returns while the active player cannot act (absent or down), the turn
  passes on (`reassignTurnIfActivePlayerIneligible`).
- If nobody can act at the start of a round (everyone standing is disconnected), the round
  pauses on the first standing survivor in turn order; a down survivor is never made active.
  Every command also re-checks that the sender is standing (`PLAYER_NOT_ACTIVE`).
- Absent players keep their position, health, and action points.

## Movement (`rules/movement.ts`)

- Movement is 4-directional (no diagonals) through walkable tiles.
- A move goes to a destination tile; the server computes the shortest path using
  breadth-first search (`pathfinding/bfs.ts`). Other players and zombies block the path.
- Cost is `moveCostPerTile` (currently 1) action points per tile stepped, for the whole path.
- A move is rejected, in this order of checks, when the destination is:
  outside the map, a wall or a shut door or window, the player's own tile, occupied,
  unreachable, or more expensive than the player's remaining action points. Shut doors and
  intact windows block the path as walls do; a move never opens anything.
- Turn checks come first for every command: unknown player, match finished, not a player
  turn, not the active player (`commands/turnChecks.ts`).

## Zombie phase (`zombies/`)

Every zombie acts once per round, in id order, each seeing the board as the previous one
left it. For each zombie, `decideZombieAction` (`zombies/targetSelection.ts`) picks one of,
in this order:

1. **Attack** if a standing survivor (status `active`, connected or not) is orthogonally
   adjacent. The first such survivor in turn order is hit for the zombie type's `damage`.
2. **Pursue** a survivor it can **see**: within the type's `sightRange` (Chebyshev
   distance, 6 for a walker) with a clear line of sight (same Bresenham rule as shooting).
   It steps one tile along the shortest path to a free tile next to the nearest visible
   standing survivor, then decides again, up to the type's `movesPerPhase` steps. Distance
   is BFS path length. Ties are broken by turn order, so there is no randomness. Survivors
   block the search; other zombies do not, but a zombie never steps onto an occupied tile
   (a queue in a corridor waits for the zombie in front to move). Seeing a survivor clears
   any remembered noise.
3. **Investigate** a noise (see Noise below) when no survivor is visible: the best audible
   noise this phase, or failing that the spot it remembered from an earlier phase. It walks
   one tile at a time toward the spot, or toward the nearest walkable tile beside it when
   the spot itself cannot be reached (a survivor is still standing there, say). Arriving on
   or next to the spot forgets it, as does finding nothing around it reachable. A zombie
   that remembers a spot but is boxed in keeps the memory and waits.
4. **Wait** otherwise.

A `slow` type (the brute) gets no steps in odd-numbered rounds: it still attacks an adjacent
survivor and still picks up and remembers noises, but a step it would have taken becomes a
wait. An `unshakable` type is never moved by melee knockback.

A zombie that sees nobody and hears nothing stays where it is, so survivors can slip past
zombies by keeping walls between them and staying quiet. Zombies path around shut doors
and intact windows exactly as around walls; they cannot interact with them, though they can
see through windows.

Zombies take damage only from survivor attacks (see Combat) and die at zero health.

## Noise (`rules/noise.ts`)

Loud actions leave a `NoiseEvent` in `state.noises`: a position, an `intensity` (how many
tiles it carries), a `sourceType`, and `remainingRounds`.

- **Sources**: firing a weapon makes a noise of the weapon's `noise` at the shooter's tile
  (pistol 8); searching a container makes a noise of `searchNoise` (2) at the container's
  tile. Movement is silent. A source with intensity 0 makes no noise.
- **Hearing** ignores walls: a zombie hears a noise when its Chebyshev distance to the
  noise is at most the intensity.
- **Choosing**: among the noises a zombie can hear, it prefers the highest _score_
  (intensity minus distance, so a loud far shot can beat a quiet nearby rummage); a tie goes
  to the earlier noise (lower id).
- **Decay**: every noise loses one round at the end of each zombie phase and disappears at
  zero; `noiseDurationRounds` (2) is the starting value, so a shot fired during round _n_
  is audible in the zombie phases of rounds _n_ and _n + 1_. The zombie's memory of the
  spot outlives the noise (`investigating` on the zombie) until it arrives or sees someone.
- Noises are deterministic: they are part of the state, created by commands, and never
  rolled.

## Combat (`rules/combat.ts`, `rules/lineOfSight.ts`)

Weapon numbers live in `packages/game-data/src/weapons.ts`. Every survivor carries one
firearm (the `weapon` slot, starting with a pistol) and one melee weapon (the `meleeWeapon`
slot, starting with a knife). Weapons differ in reach, action economy, ammunition, and
noise, not just damage:

| Weapon  | Kind    | Damage | Range | AP  | Ammunition           | Noise | Special                   |
| ------- | ------- | ------ | ----- | --- | -------------------- | ----- | ------------------------- |
| pistol  | firearm | 2      | 4     | 1   | pistol rounds, mag 6 | 8     | the reference weapon      |
| shotgun | firearm | 5 / 3  | 2     | 1   | shells, mag 2        | 12    | damage falls off by range |
| rifle   | firearm | 4      | 7     | 2   | rifle rounds, mag 5  | 10    | long reach, slow          |
| knife   | melee   | 1      | 1     | 1   | none                 | 0     | silent                    |
| bat     | melee   | 2      | 1     | 2   | none                 | 1     | knocks the target back    |

- **Fire** (`fire_weapon` at a zombie id) uses the firearm slot. Checked in this order: the
  target exists, it is within range, there is line of sight, the magazine is not empty, the
  player has enough action points. A legal shot always hits; there is no hit roll. Damage
  is the weapon's `damage`, or for a weapon with `damageByDistance` the entry for the
  target's Chebyshev distance (shotgun: 5 at one tile, 3 at two). One round is spent.
- **Strike** (`melee_attack` at a zombie id) uses the melee slot. Checked in order: the
  target exists, it is adjacent (Chebyshev distance 1, so diagonals count), action points.
  No ammunition and no line-of-sight check. A `knockback` weapon shoves a surviving target
  one tile directly away from the attacker when that tile is walkable, not shut by a
  barrier, and unoccupied; otherwise the target stays put. A dead target is never moved.
- **Range** is Chebyshev distance: the larger of the horizontal and vertical tile distance,
  so a diagonal counts as one.
- **Line of sight** follows Bresenham's line between the two tiles, checked in both
  directions so it is symmetric. Any tile strictly between them that `blocksVision` (walls)
  blocks the shot, as does a closed or locked door. Windows, open doors, and broken
  barriers never block sight, and neither do survivors or zombies.
- **Noise**: every shot or strike, hit or not, makes a noise of the weapon's `noise` at
  the attacker's tile (see Noise). A knife's 0 makes none.
- **Ammunition** comes in kinds (`pistol_rounds`, `shells`, `rifle_rounds`); each firearm
  uses one, and the reserve is kept per kind. **Reload** (`reload`) fills the magazine from
  the reserve of the firearm's kind, limited by what that reserve holds. Rejected when the
  magazine is full, that reserve is empty, or action points are short. Survivors start
  with 12 pistol rounds and nothing else; an ammo box adds 6 pistol rounds, a shell box 4
  shells, a rifle clip 5 rifle rounds.
- **Swapping weapons**: a weapon lying on the ground (`pistol`, `shotgun`, `rifle`,
  `knife`, `bat` items) is equipped by picking it up (`pick_up`, 1 AP, no inventory room
  needed). It replaces the slot of its kind; the old weapon is dropped on the survivor's
  tile as a ground item, so the swap can be undone. A replaced firearm is unloaded first
  (its rounds return to the reserve) and the new firearm starts empty, so a swap costs a
  reload. Weapons never sit in the inventory and cannot be used with `use_item`.
- A zombie at zero health dies and is removed from the board (`entity_died`).
- Survivors cannot be attacked by other survivors.

## Scenarios and objectives (`objectives/`)

A match plays a scenario: an ordered list of objective primitives from
`packages/game-data/src/scenarios.ts`. The host picks the scenario in the lobby. The match
loop knows nothing about scenarios; it evaluates the current step once per end of round,
after the zombie phase, and only ever looks at `state.objective`.

| Primitive        | Complete when                                                                                                                                                   | Progress events                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `reach_location` | every standing survivor is in the zone (and, with `requireItem`, one of them in the zone carries it), for `holdRounds` further checks; leaving resets the count | `objective_progress` (held/needed) |
| `acquire_item`   | any standing survivor carries the item                                                                                                                          | none                               |
| `survive_rounds` | `rounds` end-of-round checks have passed since the step began                                                                                                   | `objective_progress`               |

- Completing a step emits `objective_step_completed`; the next step becomes current and
  emits `objective_step_started`; completing the last step wins (`match_ended` victory).
  One step is checked per round, so a two-step scenario needs at least two rounds.
- Locations: `extraction` is the `E` tiles (green on the client, a 2x2 far from the spawn
  in generated cities); `safehouse` is the `H` tiles (the 2x2 of road the survivors start
  on in generated cities; hand-authored maps without `H` use the spawn tiles).
- Items a step asks for are placed at the layout's objective spawns (`R` tiles; in
  generated cities the farthest reachable interior floor tile from the survivors, chosen
  without randomness). They are ordinary ground items: pick them up, carry them, drop
  never (there is no drop yet), and they cannot be used.
- Down survivors are left behind and do not count for `reach_location`; at least one
  standing survivor is needed.
- Defeat (everyone down) is checked before the objective, so it wins ties.
- Setup validation refuses a scenario the layout cannot host: a missing objective spawn
  for an `acquire_item` step, an unknown item, or no steps at all. Generated cities are
  further checked by the layout validator (`packages/map-generation`): the extraction zone,
  the safehouse, and every objective spawn must exist and be reachable from every spawn.
  A hand-authored map without the tiles a step names simply never completes that step.

Scenarios shipped:

| Scenario     | Steps                                                  |
| ------------ | ------------------------------------------------------ |
| `extraction` | reach `extraction`, hold 1 more round                  |
| `retrieval`  | acquire `radio_parts`; reach `safehouse` carrying them |

## Doors and windows (`rules/barriers.ts`)

Every `door` and `window` tile holds one barrier entity in `state.barriers`, the only part
of the terrain that changes during a match. Zombies never open, close, or break anything:
a shut door is a wall to them, so survivors can shut zombies out or slip past unseen.

| Kind, state      | Movement | Vision | How it changes                                            |
| ---------------- | -------- | ------ | --------------------------------------------------------- |
| door, `open`     | passes   | clear  | `close_door` (1 AP) when nobody stands in the doorway     |
| door, `closed`   | blocks   | blocks | `open_door` (1 AP)                                        |
| door, `locked`   | blocks   | blocks | `open_door` (1 AP) spends a carried key; or `force_entry` |
| door, `broken`   | passes   | clear  | permanent                                                 |
| window, `closed` | blocks   | clear  | `force_entry`                                             |
| window, `broken` | passes   | clear  | permanent                                                 |

- **Reach**: a survivor works a barrier from their own tile or an orthogonally adjacent
  one (never diagonally).
- **Open** (`open_door`). Checked in order: the barrier exists, it is in reach, it is a
  door, it is not already open, it is not broken, a locked door needs a key in the
  inventory, action points (`openDoorActionPointCost`, 1). Opening a locked door consumes
  one key; a key has no other use and cannot be used through `use_item`.
- **Close** (`close_door`). Checked in order: exists, in reach, a door, not broken, open,
  nobody (the closer included) stands on its tile, action points
  (`closeDoorActionPointCost`, 1).
- **Force** (`force_entry`). Checked in order: exists, in reach, forceable (a locked door or
  an intact window; a closed door is simply opened), action points
  (`forceEntryActionPointCost`, 2). The barrier becomes `broken` for good and a noise of
  `forceEntryNoise` (6) is made at its tile through the ordinary noise rules, so the
  choice at a locked entrance is: find a key (quiet, costs the key), walk around (time), or
  break in (fast, loud).
- Keys drop from home, police, and shop cabinets and from ground loot
  (`packages/game-data/src/containers.ts`, `items.ts`).
- Buildings come from templates in `packages/map-generation/src/templates/buildings.ts`:
  `+` is a closed door, `k` a locked door, `w` a window. Hand-authored maps use `+`, `O`
  (open), `K` (locked), and `W`.

## Scavenging (`rules/search.ts`)

Buildings contain searchable containers (cabinets, shelves, lockers) placed by the building
templates; each has a category (`home`, `clinic`, `police`, `shop`) that decides its loot
table in `packages/game-data/src/containers.ts`. Searching costs `searchActionPointCost`
(2 action points).

- **Search** (`search` with a container id). Checked in order: the container exists, it is
  on the player's tile or an adjacent one (diagonals count), it has not been searched, the
  player has enough action points.
- Loot is rolled from the category's table: between `minRolls` and `maxRolls` weighted
  draws, where a "nothing" draw yields no item. The roll depends only on the match seed and
  the container's id, so the same seed always puts the same loot in the same cabinet no
  matter who searches or in what order.
- Found items go into the searcher's inventory while there is room; anything that does not
  fit is dropped on the container's tile as an ordinary ground item and can be picked up
  later by anyone.
- A container never yields twice. Searched containers stay on the map, greyed out.
- Searching makes a noise of `searchNoise` (2) at the container's tile (see Noise).

Item numbers live in `packages/game-data/src/items.ts`: a bandage heals 3, a medkit heals
5, an ammo box adds 6 pistol rounds, a shell box 4 shells, a rifle clip 5 rifle rounds;
using any costs 1 action point, and picking up costs 1. Keys and weapons are picked up but
never "used": keys open locked doors, weapons go straight into a slot (see Combat).

- **Pick up** (`pick_up` with an item id) takes a ground item lying on the player's own
  tile into their inventory. Checked in order: the item exists, it is on the player's tile,
  the inventory has room, the player has enough action points.
- **Use** (`use_item` with an item type) consumes one carried item of that type and applies
  its effect. A medkit is refused at full health; healing never exceeds max health. An ammo
  box always adds to the reserve (it does not reload the magazine).
- Items do not occupy tiles; anyone can stand on them. There is no drop, trade, or search
  of containers yet.

## Health and being down (`rules/health.ts`)

- Damage removes health, never below zero. A survivor at zero health has status `down`.
- Down survivors stay on the board, occupy their tile, keep their action points and
  position, are skipped in turn order, and are ignored by zombies.
- There is no way to revive a down survivor yet.

## Not yet implemented

Dropping or trading items, other game modes, noise from movement or from doors opening,
zombies breaking doors, barricades, weapon durability or attachments.
