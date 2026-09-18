# ADR 0013: Performance budgets from measurement

## Status

Accepted (engineering milestone R).

## Context

The simulation had never been measured. Optimising on intuition would have touched the
rules (the code least safe to touch) for unknown gain, and budgets picked from the air
would fail on the wrong runner or pass while play was slow.

## Decision

- **Measure first, on fixtures derived from the rules.** The worst credible zombie
  population (120) is what the reinforcement schedule can produce in a sixty-round match
  with no kills; the large map is twice the default in each dimension; the noisy board
  has forty live noises. The fixtures are deterministic so every run measures the same
  work (`apps/server/src/bench/fixtures.ts`).
- **A dependency-free harness.** `measure()` is thirty lines around `performance.now()`
  with warm-up, a fixed iteration count and a time cap, reporting the median and p95.
  Vitest's `bench` mode would have done as well; a hand-written table was simpler to
  paste into docs and to diff between runs.
- **Profile before changing anything.** The CPU profile put 80% of the zombie phase in
  the breadth-first search and its passability closure. Two changes followed, both
  provably behaviour-preserving (same visiting order, same answers per tile), and the
  playtest matrix reproduced exactly, so `SIMULATION_VERSION` did not change.
- **Budgets are ceilings derived from hosting, capped at ten times the measurement.**
  One process, one thread, human-paced turns: 50 ms per end of round keeps twenty
  coinciding round ends under a second; 10 ms per ordinary command. `budgets.test.ts`
  runs in the normal suite as a tripwire with an order of magnitude of headroom, so it
  catches a regression and not a slow runner.
- **Client cost is measured in two layers.** The pure work (decode, store, animation
  plan) in Node, and the real page in headless Chromium through a fake protocol server
  and instrumentation injected by Vite into the page's own world. Frame times are not
  reported from headless runs: software GL paces `requestAnimationFrame` at a few frames
  a second, which says nothing about real hardware.

## Consequences

- The BFS is now the one place in game-core written for speed (typed arrays, index
  arithmetic). Its tests and the determinism suite are the guard against a slip in the
  visiting order.
- The journal fingerprint is the largest remaining fixed cost per command (1 to 3 ms);
  it is documented, not optimised, until something needs it.
- `docs/PERFORMANCE.md` is the record; a budget change without a new measurement in that
  file is a review finding.
