# Game rules (as implemented)

This document describes current behaviour only. Where a rule is owned by a specific file,
that file is named so the rule can be changed in one place.

## Match setup

- 1–4 players. Each player is assigned a spawn tile in join order (`state/createInitialState.ts`).
- The map is the hard-coded fixture `SMALL_TEST_MAP` (`map/testMaps.ts`), parsed from ASCII:
  `#` wall, `.` floor, `S` floor with a spawn, `E` floor in the extraction zone.
- Every survivor starts with the values in `packages/game-data/src/survivors.ts`
  (10 health, 4 action points) and full action points.
- The match seed is chosen by the server. Gameplay randomness (none yet) comes from an
  Rng whose cursor is stored in `GameState.rngState`.

## Turn sequence

```
round N:  player_turn(first eligible) -> player_turn(next eligible) -> ... -> zombie_phase -> end_of_round
round N+1: ...
```

- Turn order is fixed at match start in join order (`GameState.turnOrder`).
- A player is **eligible** to act while `present` is true (`turn/turnOrder.ts`).
  Later milestones add "not down" and "not extracted".
- A turn ends only when the active player sends `end_turn`, or when the active player
  becomes absent while someone else is present. Reaching zero action points does **not**
  end the turn.
- After the last eligible player, the zombie phase runs (`turn/phases.ts`). With no zombies
  it passes straight through to end of round.
- End of round: the round counter increases and every player's action points are refilled
  to their maximum. The first eligible player in turn order becomes active.
- The objective is not evaluated yet, so a match never reaches the `finished` phase in this
  milestone.

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

## Not yet implemented

Zombies, combat, line of sight, inventory, extraction evaluation, victory and defeat.
