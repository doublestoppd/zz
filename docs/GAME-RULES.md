# Game rules (as implemented)

This document describes current behaviour only. Where a rule is owned by a specific file,
that file is named so the rule can be changed in one place.

## Match setup

- 1–4 players. Each player is assigned a spawn tile in join order (`state/createInitialState.ts`).
- The map is the hard-coded fixture `SMALL_TEST_MAP` (`map/testMaps.ts`), parsed from ASCII:
  `#` wall, `.` floor, `S` floor with a spawn, `E` floor in the extraction zone, `Z` floor
  with a zombie spawn. The fixture spawns three walkers.
- Every survivor starts with the values in `packages/game-data/src/survivors.ts`
  (10 health, 4 action points) and full action points.
- Zombies start with the health in `packages/game-data/src/zombies.ts` (walker: 3 health,
  2 damage).
- Every survivor carries the starting weapon from `packages/game-data/src/survivors.ts`
  (a pistol with a full magazine) and 12 rounds of reserve ammunition.
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
- When any player returns while the active player is absent, the turn passes on
  (`reassignTurnIfActivePlayerAbsent`).
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
left it. For each zombie, `decideZombieAction` (`zombies/targetSelection.ts`) picks one of:

1. **Attack** if a standing survivor (status `active`, connected or not) is orthogonally
   adjacent. The first such survivor in turn order is hit for the zombie type's `damage`.
2. **Step** one tile along the shortest path to a free tile next to the nearest standing
   survivor. Distance is BFS path length. Ties are broken by turn order, so there is no
   randomness. Survivors block the search; other zombies do not, but a zombie never steps
   onto an occupied tile (a queue in a corridor waits for the zombie in front to move).
3. **Wait** if no survivor is reachable or the next tile is occupied.

Zombies do not act on a zombie's turn in any other way; they have no health loss yet
(combat milestone).

## Combat (`rules/combat.ts`, `rules/lineOfSight.ts`)

Weapon numbers live in `packages/game-data/src/weapons.ts`. The pistol: 2 damage, range 4,
magazine 6, 1 action point to fire, 1 action point to reload.

- **Fire** (`fire_weapon` at a zombie id). Checked in this order: the target exists, it is
  within range, there is line of sight, the magazine is not empty, the player has enough
  action points. A legal shot always hits for the weapon's `damage`; there is no hit roll.
  One round is spent per shot.
- **Range** is Chebyshev distance: the larger of the horizontal and vertical tile distance,
  so a diagonal counts as one.
- **Line of sight** follows Bresenham's line between the two tiles. Any tile strictly between
  them that `blocksVision` (walls) blocks the shot. Survivors and zombies never block sight.
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

## Health and being down (`rules/health.ts`)

- Damage removes health, never below zero. A survivor at zero health has status `down`.
- Down survivors stay on the board, occupy their tile, keep their action points and
  position, are skipped in turn order, and are ignored by zombies.
- There is no way to revive a down survivor yet.

## Not yet implemented

Melee, more weapons, ammunition pickup, inventory, other game modes, procedural maps.
