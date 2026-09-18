# Balance, playtesting, and instrumentation

The last gameplay milestone's disciplined pass over the numbers. Every tunable value lives
in `packages/game-data/src/`; game-core reads them and never hard-codes one. This document
records what they are, why, what was measured, and what to watch for.

## Where the numbers live

| Area           | File                                                         | Highlights                                                                       |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Survivor       | `survivors.ts`                                               | 10 health, 4 AP, pistol + knife, 12 pistol rounds, 3 inventory slots             |
| Specialties    | `specialties.ts`                                             | whole-number modifiers, one per activity                                         |
| Rules          | `rules.ts`                                                   | move 1 AP/tile, pick up 1, search 2, doors 1/1/2 AP, force noise 6, vision 8     |
| Weapons        | `weapons.ts`                                                 | pistol 2/4/1AP/noise 8; shotgun 5-3/2/12; rifle 4/7/2AP/10; knife 1; bat 2+shove |
| Items          | `items.ts`, `containers.ts`                                  | bandage 3, medkit 5, ammo box 6, shells 4, rifle clip 5; tables per building     |
| Zombies        | `zombies.ts`                                                 | walker 3hp/2dmg/1 move; runner 2/1/2 moves; brute 8/4/slow/unshakable            |
| Threat         | `threat.ts`                                                  | level per 4 rounds or 40 heat or objective step; waves from level 1              |
| Dynamic events | `dynamicEvents.ts`                                           | 15-45 % per round from level 1, 2 rounds apart                                   |
| Scenarios      | `scenarios.ts`                                               | extraction (hold 1 round), retrieval (radio parts home)                          |
| City           | `map-generation/src/city.ts` and the server's `createLayout` | 26x18, 3+players zombies, 2+players loot, 1 objective item                       |

## Action point economy

A turn is 4 AP (5 for an athlete). Moving is 1 per tile, so a survivor who does nothing
else covers 4 tiles a round while a walker covers 1 and a runner 2: distance is safety
against walkers, not runners. Every other action competes with movement: a search (2) is
half a turn, forcing a door (2) likewise, a pistol shot (1) is a tile, a rifle shot (2)
two. Reloading (1) is the tax on emptying a magazine; the officer removes it. The
design intent is that a round is a visible trade between ground gained, loot found, and
zombies removed, and that no action is free.

## Weapons, ammunition, and noise

The pistol is the reference: two hits per walker, six rounds a magazine, twelve in
reserve, so a survivor starts with nine walkers' worth of damage. The shotgun kills a
walker at one tile and a runner at two, but is the loudest thing in the game (12 tiles)
and holds two shells; shells only come from police cabinets, shops, and caches. The
rifle drops a walker or runner in one shot from seven tiles for two AP; its clips are
police loot. The knife is silent and always available; the bat costs a whole half turn
but shoves. Noise feeds the threat level (40 heat per level), so shooting everything is
the fastest way to bring the waves.

## Zombies and spawn pressure

Initial population is 3 + players (4 to 7) placed outdoors at least a third of the map
away. Waves start at level 1 (one zombie every 3 rounds) and reach two every round at
level 4, with runners and brutes more common as the level climbs. A brute needs a full
pistol magazine or a shotgun blast plus a pistol round; it is slow, so it is a wall to
route around rather than a chase.

## Loot by location

Homes: bandages, some ammo, a bat, a key. Clinics: medkits and bandages, never nothing.
Police: ammunition of every kind, the shotgun and rifle, keys, behind a locked door or a
window. Shops: sparse, sometimes a knife or shells. Ground loot is 2 + players items.
The scavenger's extra draw is the only way to get more from a cabinet.

## Threat and pacing

With `roundsPerLevel` 4 the first four rounds are level 0 from time alone; a party that
fires a handful of shots in that window reaches level 1 early. In the bot runs below
threat reached 3 or 4 by the end of every match around round 12: heat from gunfire is the
dominant input, which is the intent (quiet play stays quiet longer).

## Objective time and travel

The extraction zone is placed as far from the safehouse as the streets allow, about
15-25 path tiles: four to six rounds of walking for a party that does nothing else. The
radio parts are the farthest reachable interior tile, so retrieval is roughly twice the
walk plus a building entry.

## Player count scaling

Explicit, in the server's `createLayout`: zombies 3 + players, loot 2 + players, one
survivor spawn per player, one objective item. The extraction zone is 2x2, so four
players fill it exactly; the safehouse is the 2x2 the party starts on.

## Instrumentation

The server writes two structured log lines per match (`apps/server/src/match/ServerMatch.ts`):

- `match started`: match code, seed, scenario, player count, specialties.
- `match ended`: the above plus outcome, rounds, final threat and heat, zombies spawned
  and left, counts of `weapon_fired`, `weapon_swung`, `weapon_reloaded`, `item_used`,
  `container_searched`, `barrier_forced`, `door_opened`, `entity_died`,
  `zombie_attacked`, `dynamic_event`, and every `player_downed` with its round.

A seed plus scenario and player count reproduces the map, loot, zombie types, waves, and
events exactly; the event log of the match is the rest of the replay.

## Playtest matrix (greedy bots)

`apps/server/src/simulation.test.ts` plays extraction with the default balance using a
deliberately plain bot (shoot what is within two tiles, reload when empty, walk to the
objective, open or force doors in the way). Results are a floor for human play:

| players | seed | outcome | rounds | downs | threat |
| ------- | ---- | ------- | ------ | ----- | ------ |
| 1       | 1    | victory | 10     | 0     | 3      |
| 1       | 2    | victory | 11     | 0     | 2      |
| 1       | 3    | victory | 11     | 0     | 2      |
| 1       | 4    | victory | 12     | 0     | 3      |
| 2       | 1    | victory | 15     | 0     | 3      |
| 2       | 2    | victory | 11     | 0     | 2      |
| 2       | 3    | victory | 13     | 0     | 4      |
| 2       | 4    | victory | 12     | 0     | 3      |
| 3       | 1    | victory | 14     | 0     | 4      |
| 3       | 2    | victory | 12     | 0     | 4      |
| 3       | 3    | victory | 13     | 0     | 4      |
| 3       | 4    | victory | 12     | 0     | 3      |
| 4       | 1    | victory | 14     | 0     | 4      |
| 4       | 2    | victory | 15     | 0     | 4      |
| 4       | 3    | victory | 15     | 0     | 4      |
| 4       | 4    | victory | 14     | 0     | 4      |

Every party size completes the baseline scenario; the test asserts that no match times
out and that victories exist. Rerun it after any balance change and paste the table here.

## Known balance notes

- Bots that march straight to the zone are never downed: walkers cannot catch a party
  moving four tiles a round, and the bots shoot runners as they close. Pressure on a
  party that explores and searches (the intended play) is untested by bots; humans
  should report whether rounds 8-15 feel dangerous enough. If not, raise
  `reinforcementCount` at levels 2-3 or lower `roundsPerLevel` to 3.
- A first bot version walled its own teammates out of the 2x2 extraction zone by taking
  the entrance tiles first; the zone is a real chokepoint for four players. The
  generator could prefer 2x2 squares with three or more open neighbours.
- The shotgun one-shots walkers and runners next door; with brutes rare it may feel like
  a strict upgrade despite the noise. Watch heat-driven threat in matches with shotguns.
- Keys are common enough (three tables plus ground loot) that forced entry is a choice,
  not a necessity; police stations without a key still fall to a window.
- Retrieval has no bot run yet; its walk is about twice extraction's, so the threat will
  sit at 4 for its second half. The `survive_rounds` primitive is unused by shipped
  scenarios.
- Specialties are whole-number modifiers and none is required; the athlete's extra AP is
  the strongest in bot terms (25 % more movement). Consider 5 AP for everyone if matches
  feel slow.

## Playtest checklist

1. One player, extraction, default seed: finish within 15 rounds without a down.
2. Four players, extraction: the zone fills; nobody is walled out.
3. Retrieval, two players: parts found by round 8, delivered by round 16.
4. Fire the shotgun twice in round 1: threat 1 by round 2, a wave by round 3 or 4.
5. Force a window next to a walker cluster: they converge on the noise, not on you.
6. Close a door on a pursuing runner: it stops; open it: it resumes.
7. Fog: nothing beyond eight tiles or behind a shut door is drawn live; explored tiles
   stay dimmed with their last-known cabinets and doors.
8. Let a car alarm ring: zombies leave you alone for three rounds.
9. Pick up a rifle from a police cabinet: it starts empty; a clip loads it.
10. Read the two `match started` / `match ended` log lines and confirm seed, outcome,
    rounds, and counts match what you played.
