# Game rules (as implemented)

This document describes current behaviour only. Where a rule is owned by a specific file,
that file is named so the rule can be changed in one place.

## Match setup

- 1–4 players. Each player is assigned a spawn tile in join order (`state/createInitialState.ts`).
- The map is generated from the match seed (`packages/map-generation`): a 26x18 city with a
  road grid, blocks of buildings with doors, four survivor spawns together on the western
  road, a 2x2 extraction zone as far from the spawns as the streets allow, five walkers
  spawned at least a third of the longest path away, and six loot spawns on open ground
  inside buildings where possible. Tile types: `floor`, `road`, `door`
  (all walkable, none block sight) and `wall`. The same seed always produces the same city.
- Tests use the hand-authored fixture `SMALL_TEST_MAP` (`map/testMaps.ts`) instead.
- Every survivor starts with the values in `packages/game-data/src/survivors.ts`
  (10 health, 4 action points) and full action points.
- The zombie type at each spawn is rolled from the weighted spawn table in
  `packages/game-data/src/zombies.ts` on its own RNG stream (currently only walkers: 3
  health, 2 damage, 1 move per phase).
- Every survivor carries the starting weapon from `packages/game-data/src/survivors.ts`
  (a pistol with a full magazine), 12 rounds of reserve ammunition, and an empty inventory
  with room for 3 items.
- Each loot spawn on the map holds one ground item whose type is rolled from the weighted
  loot table in `packages/game-data/src/items.ts` (bandage 2 : medkit 1 : ammo box 2) using
  the `loot` Rng stream, so the same seed always yields the same loot. Most supplies come
  from searching containers instead (see Scavenging).
- The match seed is chosen by the server. Gameplay randomness (none consumed yet) comes
  from an Rng whose cursor is stored in `GameState.rngState`.

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
  2. The extraction objective is evaluated (below) and may end the match in **victory**.
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
  outside the map, a wall, the player's own tile, occupied, unreachable, or more expensive
  than the player's remaining action points.
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

A zombie that sees nobody and hears nothing stays where it is, so survivors can slip past
zombies by keeping walls between them and staying quiet.

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

Weapon numbers live in `packages/game-data/src/weapons.ts`. The pistol: 2 damage, range 4,
magazine 6, 1 action point to fire, 1 action point to reload.

- **Fire** (`fire_weapon` at a zombie id). Checked in this order: the target exists, it is
  within range, there is line of sight, the magazine is not empty, the player has enough
  action points. A legal shot always hits for the weapon's `damage`; there is no hit roll.
  One round is spent per shot.
- **Range** is Chebyshev distance: the larger of the horizontal and vertical tile distance,
  so a diagonal counts as one.
- **Line of sight** follows Bresenham's line between the two tiles, checked in both
  directions so it is symmetric. Any tile strictly between them that `blocksVision` (walls)
  blocks the shot. Survivors and zombies never block sight.
- **Noise**: every shot, hit or not, makes a noise of the weapon's `noise` (pistol 8) at
  the shooter's tile (see Noise).
- **Reload** fills the magazine from reserve ammunition, limited by what the reserve holds.
  Rejected when the magazine is full, the reserve is empty, or action points are short.
- A zombie at zero health dies and is removed from the board (`entity_died`).
- There is no melee attack yet, and survivors cannot be shot.

## Extraction objective (`objectives/extraction.ts`)

The first and only scenario. Settings come from `packages/game-data/src/objectives.ts`
(`holdoutRounds`: 1).

- The extraction zone is the set of `E` tiles on the map (green on the client).
- At each end of round, after the zombie phase, the objective checks whether **every
  standing survivor** (status `active`) is inside the zone. Down survivors are left behind
  and do not count, but at least one survivor must be standing.
- The first passing check sets `roundsHeld` to 1. The zone must then be held for
  `holdoutRounds` further consecutive checks; the match is won when
  `roundsHeld > holdoutRounds`. With the default of 1, survivors must be in the zone at two
  consecutive ends of round, surviving one zombie phase in between.
- If anyone standing is outside the zone at a check, `roundsHeld` resets to 0.
- Every change to `roundsHeld` emits `extraction_progress`. Victory emits `match_ended`.
- Defeat (everyone down) is checked before the objective, so a team that all goes down in
  the zone still loses.

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
5, an ammo box adds 6 rounds to the reserve; using any costs 1 action point, and picking up
costs 1.

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

Melee, more weapons, dropping or trading items, other game modes, noise from movement or
doors.
