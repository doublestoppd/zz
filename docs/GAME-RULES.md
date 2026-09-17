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
- End of round: if every survivor is down the match ends in **defeat** (`finished` phase;
  no further commands are accepted). Otherwise the round counter increases, every player's
  action points are refilled to their maximum, and the first eligible player in turn order
  becomes active.
- Victory is not evaluated yet (objective milestone).

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

## Health and being down (`rules/health.ts`)

- Damage removes health, never below zero. A survivor at zero health has status `down`.
- Down survivors stay on the board, occupy their tile, keep their action points and
  position, are skipped in turn order, and are ignored by zombies.
- There is no way to revive a down survivor yet.

## Not yet implemented

Player attacks, line of sight, zombie death, inventory, extraction evaluation, victory.
