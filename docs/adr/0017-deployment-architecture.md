# ADR 0017: Deployment architecture

## Status

Accepted (engineering milestone V).

## Context

The game needs a predictable way to reach players, a way back when a release misbehaves,
and staged exposure before a public playtest. It has one process, in-memory matches
checkpointed to disk, no accounts, and a small population per host.

## Decision

- **One container, one process, one host per deployment.** The image serves the client
  bundle and the game on one port; TLS terminates at a reverse proxy. There is no
  orchestration requirement beyond "run this image with these environment variables and
  two volumes". Horizontal scaling would need a match router in front (a match lives in
  one process); it is not needed for the populations in question and is not designed in.
- **State on volumes, secrets in the environment.** `STATE_DIR` and `JOURNAL_DIR` are
  volumes so restarts and rollbacks keep matches and replays; `ADMIN_TOKEN` and
  `ALLOWED_ORIGINS` are runtime configuration; the image carries neither.
- **Readiness is the drain signal.** `/readyz` turns 503 the moment shutdown starts, so a
  proxy or orchestrator stops sending new players before sockets close; `/healthz` stays
  200 as long as the process is alive. The container's health check uses `/readyz`.
- **Shutdown is bounded.** A graceful shutdown that cannot finish in `SHUTDOWN_TIMEOUT_MS`
  exits 1 with a log line. A process that lingers half-stopped is worse than one the
  orchestrator restarts.
- **Rollback is a redeploy of the previous tag**, with the consequences of version bumps
  stated rather than hidden: a protocol bump costs every loaded client one refresh, a
  simulation bump costs the active matches of the other build. Tags, `/version`, and
  `build-info.json` all name the commit, so "what is running" is never a guess.
- **A smoke test is part of the deployment**, not a separate QA activity: it exercises
  the paths a player takes in the first minute and is the same script in CI's harness,
  on staging, and on production.
- **Rollback triggers are metrics the server already exposes**, with thresholds written
  down before the first playtest, so the decision is a lookup, not a debate.

## Consequences

- No third-party crash reporter or log service is required; the JSON log stream and the
  metrics endpoint are the observability surface, and the host collects them.
- Multi-host scaling, blue/green routing, and sticky sessions are out of scope until a
  population needs them; the match router that would enable them is the first design
  question of that milestone, not of this one.
