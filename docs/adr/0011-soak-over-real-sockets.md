# ADR 0011: Soak testing with bots over real sockets

## Status

Accepted (engineering milestone P).

## Context

The in-process playtest matrix (Milestone J) proves the rules terminate for greedy bots
but never touches sessions, the protocol, redaction, journaling, or reconnection. Bugs in
those layers only show under interleavings a hand-written test does not think of.

## Decision

- **Bots play through the real server.** The soak starts the production `MatchRegistry`
  and `startSocketServer` on an ephemeral port and connects `ProtocolClient`s; the bots
  see only what a browser sees (`map` once, then redacted `update`s) and act with the
  same greedy policy the in-process matrix uses (`soak/botPolicy.ts`, shared).
- **Deterministic by seed.** The match seed drives the city and the simulation; the chaos
  schedule (which bot drops when, which probe is sent) comes from a bot RNG derived from
  the same seed. Rerunning `--seed N --players P --chaos` reproduces the run up to socket
  timing, which the protocol is designed to absorb (stale commands are re-decided from
  the newer snapshot, as the browser client does after a resync).
- **Invariants on every snapshot, not at the end.** Bounds, non-negative AP and ammo, an
  eligible active player whenever anyone is eligible, and cross-client agreement (every
  bot's fingerprint of a revision must match). Rejections are classified: a rule
  rejection of a bot's move is acceptable (fog of war), anything else fails the match.
- **Failures persist as journals.** A failing seed writes the match journal in the format
  the replay CLI accepts plus a `.failure.json` with the reason and rerun command, so a
  nightly failure is a file, not a log line to reconstruct from.
- **Two sizes.** Eight chaos matches run in the regular suite (a few seconds); the CLI runs
  hundreds for the nightly job (Milestone U).

## Consequences

- The soak is a server-app concern; game-core stays unaware of sockets and bots.
- Long matches are normal for greedy bots on some cities (seed 20 with four players takes
  over a hundred rounds without chaos), so the round cap is a stuck-game detector, not a
  balance assertion. Balance assertions stay in the in-process matrix.
- The stale-revision retry in the bot is deliberate: with several clients and presence
  changes it is the protocol's expected path, and a soak that failed on it would be
  testing its own impatience.
