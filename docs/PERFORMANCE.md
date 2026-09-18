# Performance

Measured budgets for the authoritative simulation, the wire, and the client, on
deterministic fixtures. Numbers are medians in milliseconds on the development container
(Node 22, one core, no GPU); budgets carry an order of magnitude of headroom so a CI runner
is noisier but never close. Rerun and paste with:

```
pnpm --filter @zombie/server bench          # simulation, generation, serialization
pnpm --filter @zombie/client bench          # the client's pure per-update work, in Node
CHROMIUM_PATH=... pnpm --filter @zombie/client bench:render   # the real client in headless Chromium
```

## Fixtures (`apps/server/src/bench/fixtures.ts`)

Sizes come from the rules, not from guesses:

| Fixture   | What                                                                                                | Why this size                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typical` | 4 survivors, default 26x18 city (seed 1), after 12 rounds of greedy play: 11 zombies, 2 live noises | What a real match holds once reinforcements have started.                                                                                                                            |
| `heavy`   | the same board with 120 zombies                                                                     | Waves add at most 2 zombies a round at threat 4 and a horde adds 3 (`game-data/threat.ts`, `dynamicEvents.ts`): 120 is a sixty-round level-4 match in which nothing was ever killed. |
| `large`   | a 52x36 city (twice the default in each dimension, four times the tiles) with 120 zombies           | The server only generates the default size today; this bounds a future map-size option.                                                                                              |
| `noisy`   | `heavy` plus 40 live noises of mixed intensity                                                      | Every zombie has something to hear and score.                                                                                                                                        |

## Server measurements

`before` is the first run of the harness; `after` is the current code, after the two
optimisations below. Per-command work (`runtime.apply`) includes the rules, the phase
drive, the critical invariant check, and the revision.

| case                                            | before ms | after ms | p95 after | note                                       |
| ----------------------------------------------- | --------: | -------: | --------: | ------------------------------------------ |
| generateCity default                            |     3.191 |    2.416 |     3.038 | 26x18                                      |
| generateCity large                              |     15.27 |    11.76 |     14.71 | 52x36                                      |
| zombie phase typical                            |     2.189 |    0.415 |     0.541 | 26x18, 11 zombies, 2 noises                |
| end of round typical                            |     2.095 |    0.395 |     0.617 | 26x18, 11 zombies, 2 noises                |
| zombie phase heavy                              |     21.73 |    3.740 |     4.673 | 26x18, 120 zombies, 2 noises               |
| end of round heavy                              |     21.57 |    3.612 |     4.567 | 26x18, 120 zombies, 2 noises               |
| zombie phase large                              |     88.77 |    1.507 |     1.671 | 52x36, 120 zombies, 0 noises               |
| end of round large                              |     86.61 |    1.445 |     1.719 | 52x36, 120 zombies, 0 noises               |
| zombie phase noisy                              |     20.62 |    3.222 |     4.100 | 26x18, 120 zombies, 42 noises              |
| end of round noisy                              |     20.25 |    3.532 |     4.340 | 26x18, 120 zombies, 42 noises              |
| searchFrom (one zombie, unlimited) typical      |     0.125 |    0.015 |     0.022 | 26x18                                      |
| findShortestPath survivor to extraction typical |     0.177 |    0.014 |     0.018 | 26x18                                      |
| searchFrom (one zombie, unlimited) large        |     0.771 |    0.074 |     0.087 | 52x36                                      |
| findShortestPath survivor to extraction large   |     1.942 |    0.071 |     0.108 | 52x36                                      |
| visibilityGrid typical                          |     0.165 |    0.160 |     0.203 | 26x18, 11 zombies, 2 noises                |
| revealExplored typical                          |     0.167 |    0.165 |     0.309 | 26x18, 11 zombies, 2 noises                |
| visibilityGrid large                            |     0.486 |    0.455 |     0.622 | 52x36, 120 zombies, 0 noises               |
| revealExplored large                            |     0.478 |    0.459 |     0.597 | 52x36, 120 zombies, 0 noises               |
| bestAudibleNoise all zombies noisy              |     0.046 |    0.041 |     0.070 | 26x18, 120 zombies, 42 noises              |
| checkInvariants critical heavy                  |     0.048 |    0.042 |     0.078 | 26x18, 120 zombies, 2 noises               |
| checkInvariants full heavy                      |     0.062 |    0.057 |     0.094 | 26x18, 120 zombies, 2 noises               |
| checkInvariants critical large                  |     0.043 |    0.042 |     0.065 | 52x36, 120 zombies, 0 noises               |
| checkInvariants full large                      |     0.069 |    0.072 |     0.130 | 52x36, 120 zombies, 0 noises               |
| redactState typical                             |     0.157 |    0.195 |     0.557 | 26x18, 11 zombies, 2 noises                |
| encode update typical                           |     0.192 |    0.179 |     0.376 | 12017 bytes on the wire (redacted, no map) |
| decode update typical                           |     0.051 |    0.047 |     0.072 | 12017 bytes                                |
| fingerprint (journal checkpoint) typical        |     0.853 |    0.802 |     1.807 | 37742 bytes of full state                  |
| redactState heavy                               |     0.154 |    0.144 |     0.189 | 26x18, 120 zombies, 2 noises               |
| encode update heavy                             |     0.192 |    0.168 |     0.309 | 13474 bytes on the wire (redacted, no map) |
| decode update heavy                             |     0.060 |    0.055 |     0.075 | 13474 bytes                                |
| fingerprint (journal checkpoint) heavy          |     1.045 |    0.934 |     1.120 | 44945 bytes of full state                  |
| redactState large                               |     0.480 |    0.397 |     0.525 | 52x36, 120 zombies, 0 noises               |
| encode update large                             |     0.529 |    0.500 |     0.655 | 24861 bytes on the wire (redacted, no map) |
| decode update large                             |     0.090 |    0.084 |     0.100 | 24861 bytes                                |
| fingerprint (journal checkpoint) large          |     3.147 |    2.826 |     3.050 | 131825 bytes of full state                 |
| runtime.apply end_turn typical                  |     0.166 |    0.158 |     0.200 | 26x18, 11 zombies, 2 noises                |
| runtime.apply end_turn heavy                    |     0.172 |    0.169 |     0.297 | 26x18, 120 zombies, 2 noises               |
| runtime.apply end_turn large                    |     0.515 |    0.494 |     0.642 | 52x36, 120 zombies, 0 noises               |

Client, pure work in Node (`apps/client/src/bench`, open 40x24 room, 120 zombies all
visible, a zombie phase in which every zombie moved):

| case                                  | median ms | p95 ms |
| ------------------------------------- | --------: | -----: |
| decodeServerMessage update (31.5 KB)  |     0.178 |  0.267 |
| decodeServerMessage map (51.8 KB)     |     0.162 |  0.250 |
| ClientStore.applyServerMessage update |     0.116 |  0.168 |
| planAnimations zombie phase (120 ev.) |     0.017 |  0.044 |

Client, the real page in headless Chromium (`apps/client/bench/renderBench.mts`: a fake
server pushes twelve zombie-phase updates per population; the handler time is the
synchronous work per `update`: decode, store, HUD, board reconcile and tween setup):

| zombies | handler median ms | handler p95 ms |
| ------: | ----------------: | -------------: |
|      10 |              2.50 |           3.40 |
|      60 |              2.80 |           3.20 |
|     120 |              2.70 |           4.20 |

The handler cost is flat in the zombie count: it is dominated by the HUD's DOM rebuild
and the board reconcile's fixed work, not by sprites. Frame times could not be measured
meaningfully headless (software GL paces `requestAnimationFrame` at about 8 fps); check
the tween playback on real hardware with the browser's performance panel when the
renderer changes.

## Where the time went (profile of the heavy zombie phase, before)

`--cpu-prof` on 136 phases: 58% in the BFS `search`, 11% in `searchFrom`, 9.5% in the
passability closure (`isOccupiedByPlayer` scanning the players per tile), 5% garbage
collection. Everything else was under 2%. Two changes followed, both behaviour-preserving
(the playtest matrix in `docs/BALANCE.md` reproduces exactly; game-core's determinism and
replay tests pass unchanged):

1. `decideZombieAction` runs the full-board search only once it has a destination (a
   visible survivor or a noise). On the large map most zombies have neither, so the phase
   went from 89 ms to 11 ms; on the crowded default map it barely moved.
2. The BFS keeps distance, parent, and visiting order in `Int32Array`s indexed by
   `y * width + x` instead of string-keyed `Map`s of node objects, with the same
   neighbour order (up, right, down, left), and `passabilityFor` indexes the blocking
   entities and barriers once per search instead of scanning them per tile. One search
   went from 0.125 ms to 0.015 ms; the heavy zombie phase from 21 ms to 3.7 ms.

Not optimised, because not demonstrated: the journal checkpoint fingerprint (1 ms
typical, 3 ms on the large map, once per accepted command) canonicalises the whole state
including the immutable map; hashing without the map, or caching, would cut it but nothing
needs it yet. Serialization and redaction are well under a millisecond at every size.

## Budgets (`apps/server/src/bench/budgets.ts`, enforced by `budgets.test.ts`)

Hosting constraint: one Node process, one thread, every match's commands on the same
event loop, players acting at human speed (a command every few seconds per match). A
command's server work must therefore stay far below what a player would notice and short
enough that twenty matches ending a round in the same second do not stack into a visible
stall: 50 ms per end of round is the ceiling (twenty stacked is one second, the worst
imaginable coincidence), 10 ms for an ordinary command. Each budget is that ceiling or ten
times the measured median, whichever is smaller.

| Budget                                        |  Value | Measured median   | Headroom |
| --------------------------------------------- | -----: | ----------------- | -------: |
| end of round, heavy or noisy                  |  50 ms | 3.6 ms / 3.5 ms   |      14x |
| end of round, large                           |  50 ms | 1.4 ms            |      35x |
| player command (with critical invariants)     |  10 ms | 0.17 ms / 0.49 ms |      20x |
| `generateCity` default (inside `start_match`) | 100 ms | 3.3 ms            |      30x |
| `generateCity` large                          | 250 ms | 15.7 ms           |      16x |
| journal fingerprint, large                    |  30 ms | 3.1 ms            |      10x |
| `checkInvariants` full, heavy                 |   5 ms | 0.06 ms           |      80x |
| `update` payload, heavy (default map)         |  32 KB | 13.5 KB           |     2.4x |
| `update` payload, large                       |  64 KB | 24.9 KB           |     2.6x |

Payload budgets are exact (no timing noise): a reconnect costs the map once (12 KB
default, 52 KB large) plus one update. Client-side, an update is handled in about 3 ms
of main-thread time regardless of population, well inside one frame.

When a budget fails: rerun the bench, compare with this table, profile
(`NODE_OPTIONS=--cpu-prof`), fix the demonstrated cause, rerun `pnpm check` (the
determinism, replay, and invariant tests must pass unchanged unless the change is a
deliberate simulation change, which bumps `SIMULATION_VERSION`), then update this file.
