# ADR 0012: State invariants and fail-safe corruption handling

## Status

Accepted (engineering milestone Q).

## Context

The rules are pure functions and well tested, but a state that breaks an assumption (two
survivors on one tile, a down survivor holding the turn, negative ammunition) would be
broadcast, journaled, and persisted like any other, and every later rule would build on it.
Such states should be impossible; when a bug makes one, it must be caught where it is
made, not three rounds later in a client crash.

## Decision

- **One checker, in game-core.** `checkInvariants(state, level)` encodes every
  between-command assumption as data (`{ code, detail }`), with no side effects and no
  knowledge of who called it. Rules are not changed to call it: checking is the caller's
  concern, so the hot path in the rules stays as it is.
- **Two levels.** `critical` is what production can afford after every command
  (O(entities), a single position set): positions, occupancy, numeric bounds, turn and
  phase consistency. `full` adds reference validity, id uniqueness, objective shape, and
  counters. Tests, the replay verifier, and the soak always run `full`; the server runs
  `critical` unless `INVARIANT_CHECKS=full`.
- **Fail safe, do not fail forward.** `MatchRuntime.apply` discards a resulting state that
  violates the check: the previous state and revision stand, the journal is untouched, the
  sender gets the fixed `INTERNAL_ERROR` text (never the detail), and the server logs the
  codes and counts them. The match continues from its last consistent state. Freezing the
  match or exiting the process was rejected: both punish every player for one refused
  command, and the refused command is the only thing the guard knows is wrong.
- **Corrupt journals are refused.** `replayJournal` checks every replayed state; a journal
  with a violation is `INVARIANT_VIOLATION` at its revision and is not restored at startup.
- **Revision monotonicity by construction.** The runtime is the only writer and adds
  exactly one per accepted command; the journal append cross-checks it and throws on
  disagreement (a programming error, handled by the exception path).

## Consequences

- The guard cannot catch a state that is wrong but consistent (a zombie that should have
  moved and did not); determinism tests and replays cover that class.
- A rule that legitimately needs a new kind of state must extend the checker in the same
  change (docs/DEVELOPMENT.md, "Add an invariant"), or the soak fails on it at once.
- `describe()` exposes `invariantViolations` per match so a playtest operator sees the
  count without reading logs.
