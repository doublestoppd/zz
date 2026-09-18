# ADR 0010: Observability without an agent

## Status

Accepted (engineering milestone O).

## Context

Operators need to answer "is the server healthy, what is it doing, and why did this
player's turn go wrong" from outside the process, and bug reports need a match's state
without anyone pasting rejoin tokens. The server must stay a single process with no
required sidecar, and the game core must stay free of infrastructure.

## Decision

- **Structured logs stay the primary record.** One JSON line per event with a `category`
  (`server`, `session`, `match`, `command`, `lifecycle`) and the ids that link a report to
  a match (`matchCode`, `playerId`, `sessionId`, `commandId`, `revision`). `LOG_LEVEL`
  filters at emit time. Tokens are never logged; the socket server's exception handler
  logs the stack and closes the socket, and the client sees only the fixed
  `INTERNAL_ERROR` text.
- **Metrics are a small in-process exporter,** not a client library: counters, gauges,
  and fixed-bucket histograms rendered in the Prometheus text format at `/metrics`.
  Label values are sanitised so a hostile string cannot break the exposition, and no label
  carries player-supplied text. Registry gauges are recomputed on each scrape rather than
  maintained on every transition, so they cannot go stale.
- **Diagnostics are read-only and token-guarded.** `/admin/matches` and
  `/admin/matches/<CODE>` exist only when `ADMIN_TOKEN` is set and answer 404 (not 401)
  to anything without the bearer token, so their presence is not discoverable. They return
  summaries (`describe()` on `ServerMatch`): status, revision, round, phase, threat,
  players and their connectivity, journal metadata. Never tokens, never session ids, never
  the full state (that is what journals and `STATE_DIR` records are for).
- **Failures that would otherwise be fatal to a match are contained and counted.** A map
  generator that gives up returns the lobby to the host with `INTERNAL_ERROR`; a checkpoint
  write that fails is logged as `state not saved` and counted; both leave the match
  playable. An uncaught exception still exits the process, because its state is unknown,
  and restart recovery covers the matches.

## Consequences

- No new dependency. The exporter is simpler than a client library: no summaries or
  quantiles, fixed buckets only, no `# HELP`/`# TYPE` metadata (Prometheus tolerates its
  absence). If a richer exporter is ever needed, the call sites use three verbs
  (`increment`, `set`, `observe`) and can be redirected.
- Timing is measured around `MatchRuntime.apply` and city generation only; it never enters
  the game core.
- The metrics singleton is process-wide, so tests read counters as deltas.
