# Operations

How to run, configure, stop, and recover the game server. Deployment and rollback are in
their own section at the end (filled in by the deployment milestone).

## Configuration

All configuration is by environment variable; nothing is read from files in the source
tree and no secret is committed.

| Variable                      | Default        | Meaning                                                                                                                                                    |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                        | `8080`         | HTTP and WebSocket port.                                                                                                                                   |
| `STATIC_DIR`                  | unset          | Serve the built client from this directory on the same port.                                                                                               |
| `STATE_DIR`                   | unset (memory) | Match records for restart recovery; one JSON file per match. Private: holds tokens.                                                                        |
| `JOURNAL_DIR`                 | unset          | Finished-match journals for bug reports and replay verification.                                                                                           |
| `GAME_VERSION`                | `0.1.0-dev`    | Human-facing build label, logged at startup and recorded in journals.                                                                                      |
| `LOG_LEVEL`                   | `info`         | Lowest level written: `debug`, `info`, `warn`, or `error`.                                                                                                 |
| `ADMIN_TOKEN`                 | unset          | Enables the `/admin/...` diagnostics endpoints (bearer token). Unset: they are 404.                                                                        |
| `INVARIANT_CHECKS`            | `critical`     | State checks after every accepted command: `critical` (cheap) or `full` (staging).                                                                         |
| `ALLOWED_ORIGINS`             | unset (any)    | Comma-separated browser origins allowed to open a socket, e.g. `https://play.example`. Set it in production.                                               |
| `MAX_CONNECTIONS`             | `200`          | Concurrent sockets; more are refused at the upgrade (503).                                                                                                 |
| `MAX_CONNECTIONS_PER_ADDRESS` | `16`           | Sockets one client address may hold (429 beyond).                                                                                                          |
| `MAX_MATCHES`                 | `100`          | Lobbies plus matches in memory; `create_match` beyond it is `SERVER_FULL`.                                                                                 |
| `TRUST_PROXY`                 | unset          | `1` behind a reverse proxy that sets `X-Forwarded-For`; the first entry becomes the client address for limits and logs. Never set it without such a proxy. |

## Lifecycle of a match

```
LOBBY -> STARTING -> ACTIVE -> COMPLETED
                        \-> ABANDONED
```

`STARTING` is the synchronous window inside `start_match` (seed drawn, city generated,
initial state built and checkpointed). `ACTIVE` matches are checkpointed to `STATE_DIR`
after every accepted mutation. `COMPLETED` records are kept 24 hours. A match nobody is
connected to for 10 minutes becomes `ABANDONED` and its record is deleted. Lobbies are
never persisted.

## Startup and recovery

At startup the server restores every `active` record from `STATE_DIR` by replaying its
journal, logs `match restored` per match (or `match not restorable` with the reason, in
which case the record is removed), sweeps expired completed records, and logs
`server listening` with the counts. Players reconnect with their stored token and rejoin
exactly where they were; the turn they held has passed to the next present player.

## Graceful shutdown

SIGINT or SIGTERM: the registry stops accepting new lobbies and joins (`SHUTTING_DOWN`),
tells every connected player and closes their sockets with code 1001 ("going away"), then
the listener closes and the process exits 0 (`shutdown complete` in the log). Nothing needs
flushing: every active match was checkpointed after its last mutation. Restart the process
and the players' clients rejoin on their own.

## Logs

One JSON object per line on stdout (`debug`, `info`) or stderr (`warn`, `error`), with
`time`, `level`, `message`, a `category` (`server`, `session`, `match`, `command`,
`lifecycle`), and structured fields: `matchCode`, `playerId`, `sessionId`, `commandId`,
`revision`, `seed`, `reason`. Rejoin tokens are never logged. Command outcomes are logged
at info; a rejected command is normal play, not an error. `LOG_LEVEL` sets the threshold.

Lines to alert on:

| Message                    | Level | Meaning                                                                                                                                       |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler exception`        | error | A message handler threw. The socket was closed; the match is untouched. Has stack.                                                            |
| `uncaught exception`       | error | The process is about to exit 1. Restart it; active matches restore from `STATE_DIR`.                                                          |
| `unhandled rejection`      | error | A promise rejected with nobody listening. The process stays up.                                                                               |
| `match not restorable`     | error | A stored record did not replay at startup and was removed.                                                                                    |
| `map generation failed`    | error | The generator gave up for a seed; the lobby stays; the host got `INTERNAL_ERROR`.                                                             |
| `state not saved`          | error | A checkpoint write failed; the match keeps running in memory only.                                                                            |
| `state invariant violated` | error | A command produced a state that breaks a rule; it was discarded and the sender told `INTERNAL_ERROR`. A bug: report the seed and the command. |

## Health and readiness

- `GET /healthz` answers `{"ok":true}` while the listener is up (liveness).
- `GET /readyz` answers `{"ready":true}` (200) while the server accepts new lobbies and
  `{"ready":false}` (503) once shutdown has started, so a load balancer stops routing new
  players before the sockets close.

## Metrics

`GET /metrics` renders the Prometheus text format (no dependency; the exporter is
`observability/metrics.ts`). Registry gauges are recomputed on every scrape.

| Metric                                    | Type      | Labels              | Meaning                                                                                          |
| ----------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `zombie_process_start_time_seconds`       | gauge     |                     | Process start, for uptime.                                                                       |
| `zombie_connections_total`                | counter   |                     | Sockets accepted.                                                                                |
| `zombie_connections_refused_total`        | counter   | `reason`            | Upgrades refused: `server full`, `too many connections from this address`, `origin not allowed`. |
| `zombie_matches_refused_total`            | counter   |                     | `create_match` refused at the room limit.                                                        |
| `zombie_connected_sockets`                | gauge     |                     | Open sockets right now.                                                                          |
| `zombie_messages_rate_limited_total`      | counter   |                     | Messages dropped by the per-socket rate limit.                                                   |
| `zombie_messages_malformed_total`         | counter   |                     | Messages that failed protocol decoding.                                                          |
| `zombie_handler_exceptions_total`         | counter   |                     | Handler exceptions (each is an error log line).                                                  |
| `zombie_uncaught_exceptions_total`        | counter   |                     | Fatal process errors (the process exits after).                                                  |
| `zombie_active_matches`, `zombie_lobbies` | gauge     |                     | Started matches / lobbies held in memory.                                                        |
| `zombie_connected_players`                | gauge     |                     | Player slots with a live socket.                                                                 |
| `zombie_matches_started_total`            | counter   |                     | Matches started.                                                                                 |
| `zombie_matches_completed_total`          | counter   | `outcome`           | `victory` or `defeat`.                                                                           |
| `zombie_matches_abandoned_total`          | counter   |                     | Matches dropped after the empty grace period.                                                    |
| `zombie_matches_restored_total`           | counter   |                     | Matches restored from `STATE_DIR` at startup.                                                    |
| `zombie_commands_total`                   | counter   | `outcome`, `reason` | Accepted, or rejected with its `CommandRejectionReason`.                                         |
| `zombie_command_duration_ms`              | histogram | `kind`              | Simulation time per accepted command (`player_only` or `with_zombie_phase`).                     |
| `zombie_zombie_phase_duration_ms`         | histogram |                     | Simulation time of commands that ran a zombie phase.                                             |
| `zombie_map_generation_duration_ms`       | histogram |                     | City generation time per `start_match`.                                                          |
| `zombie_map_generation_failures_total`    | counter   |                     | Generator gave up (the host saw `INTERNAL_ERROR`).                                               |
| `zombie_persistence_failures_total`       | counter   |                     | Checkpoint writes to `STATE_DIR` that failed.                                                    |
| `zombie_invariant_violations_total`       | counter   | `code`              | Mutations discarded because the resulting state broke an invariant. Alert on any.                |
| `zombie_snapshot_bytes`                   | histogram |                     | Size of one redacted `update` payload.                                                           |
| `zombie_outbound_bytes_total`             | counter   |                     | Bytes of `update` broadcast (payload × recipients).                                              |
| `zombie_reconnect_attempts_total`         | counter   |                     | `rejoin` messages received.                                                                      |
| `zombie_reconnect_successes_total`        | counter   |                     | Rejoins that resumed a slot.                                                                     |
| `zombie_reconnect_failures_total`         | counter   | `reason`            | Rejoins refused, by error code.                                                                  |

Histograms use fixed buckets `1 5 10 25 50 100 250 500 1000 5000` and also expose `_min`
and `_max`. Suggested alerts: `zombie_handler_exceptions_total` increasing at all;
`zombie_command_duration_ms{kind="with_zombie_phase"}` p99 above 50 ms or
`{kind="player_only"}` above 10 ms (the budgets in `docs/PERFORMANCE.md`); `zombie_messages_malformed_total` rising from one address (an abusive or
outdated client).

## Diagnostics

With `ADMIN_TOKEN` set, two read-only endpoints answer to
`Authorization: Bearer <ADMIN_TOKEN>` (anything else, or no token configured, is a 404 like
any unknown path):

- `GET /admin/matches` lists every match in memory: `code`, `status`, `revision`, `round`,
  `phase`, `threat`, `journalEntries`, and `players` (`id`, `name`, `specialty`, `connected`).
- `GET /admin/matches/<CODE>` adds the journal `metadata` (seed, versions, scenario, layout
  source) for one match.

Neither returns rejoin tokens, session ids, or game state; they are safe to paste into a
bug report. To capture a live match for replay, wait for it to finish (its journal lands in
`JOURNAL_DIR`) or copy its record out of `STATE_DIR` (which does hold tokens: redact
`members[].rejoinToken` before sharing).

## Troubleshooting

A match reported by `/admin/matches/<CODE>` with `invariantViolations` above zero has
refused at least one command to protect itself; the `state invariant violated` log line
holds the codes and the command. The match is still consistent (the refused mutation never
became authoritative), so it can go on; capture its journal for the bug report.

| Symptom                                                         | Check                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Players report "connection lost" in a wave                      | `zombie_connected_sockets` dropping with `zombie_connections_total` flat means the process restarted: look for `server listening`.        |
| One player keeps getting `STALE_REVISION`                       | Normal after a reconnect (the client resyncs). Persistent: compare the `command rejected` lines' `revision` with `/admin/matches/<CODE>`. |
| A player cannot rejoin                                          | `MATCH_NOT_FOUND` after the 10-minute abandonment or a restart without `STATE_DIR`; otherwise `zombie_reconnect_failures_total{reason}`.  |
| `start_match` answers `INTERNAL_ERROR`                          | `map generation failed` log line with the seed; `zombie_map_generation_failures_total`. Report the seed.                                  |
| `/readyz` is 503 but the process is up                          | Shutdown has started (SIGTERM received). It exits once the listener closes.                                                               |
| A match looks wrong (a zombie moved through a wall, wrong turn) | Fetch its journal after it ends (or its `STATE_DIR` record) and run the replay CLI, see `docs/DEVELOPMENT.md` "Replay a match".           |

## Cleanup

- Abandoned matches delete their record automatically.
- Completed records are swept 24 hours after their last save, on the next startup.
- Journals in `JOURNAL_DIR` are never deleted by the server; rotate them with the host's
  tools.
