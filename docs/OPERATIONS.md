# Operations

How to run, configure, stop, and recover the game server, how to deploy and roll back,
and what a public playtest needs to have in place.

## Configuration

All configuration is by environment variable; nothing is read from files in the source
tree and no secret is committed.

| Variable                      | Default        | Meaning                                                                                                                                                    |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                        | `8080`         | HTTP and WebSocket port.                                                                                                                                   |
| `STATIC_DIR`                  | unset          | Serve the built client from this directory on the same port.                                                                                               |
| `STATE_DIR`                   | unset (memory) | Match records for restart recovery; one JSON file per match. Private: holds tokens.                                                                        |
| `JOURNAL_DIR`                 | unset          | Finished-match journals for bug reports and replay verification.                                                                                           |
| `GAME_VERSION`                | baked at build | Human-facing build label; baked into the bundle by the build (`0.1.0-dev` locally), overridable at start.                                                  |
| `SOURCE_REVISION`             | baked at build | The commit the artifact was built from; same rules as `GAME_VERSION`.                                                                                      |
| `LOG_LEVEL`                   | `info`         | Lowest level written: `debug`, `info`, `warn`, or `error`.                                                                                                 |
| `ADMIN_TOKEN`                 | unset          | Enables the `/admin/...` diagnostics endpoints (bearer token). Unset: they are 404.                                                                        |
| `INVARIANT_CHECKS`            | `critical`     | State checks after every accepted command: `critical` (cheap) or `full` (staging).                                                                         |
| `SHUTDOWN_TIMEOUT_MS`         | `10000`        | How long a graceful shutdown may take before the process exits 1 anyway (with a log line).                                                                 |
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

SIGINT or SIGTERM: `/readyz` turns 503 so a load balancer stops routing new players, the
registry stops accepting new lobbies and joins (`SHUTTING_DOWN`), tells every connected
player and closes their sockets with code 1001 ("going away"), then the listener closes
and the process exits 0 (`shutdown complete` in the log). Nothing needs flushing: every
active match was checkpointed after its last mutation and finished matches' journals were
written when they ended. If the listener has not closed within `SHUTDOWN_TIMEOUT_MS` the
process logs `shutdown timed out` and exits 1 rather than linger. Restart the process and
the players' clients rejoin on their own. The container's `stop_grace_period` (compose)
and the orchestrator's termination grace must exceed the timeout.

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
| `version mismatch`         | info  | A client announced another protocol version (or none) and was told to refresh; expected right after a deploy.                                 |

## Build identity

Every artifact says what it is. `apps/server/dist/build-info.json` and
`apps/client/dist/build-info.json` (copied into the container image) carry `gameVersion`,
`protocolVersion`, `simulationVersion`, `sourceRevision`, and `builtAt`. The server logs
the same at startup (`server listening`) and serves them at `GET /version` (public, no
secrets). Clients announce their `gameVersion` in the handshake and see the server's in
`welcome`; a journal records all three versions, so a replay is always traceable to the
code that can re-simulate it (`docs/DEVELOPMENT.md`, "Version bump rules").

## Health and readiness

- `GET /healthz` answers `{"ok":true}` while the listener is up (liveness).
- `GET /readyz` answers `{"ready":true}` (200) while the server accepts new lobbies and
  `{"ready":false}` (503) once shutdown has started, so a load balancer stops routing new
  players before the sockets close.

## Metrics

`GET /metrics` renders the Prometheus text format (no dependency; the exporter is
`observability/metrics.ts`). Registry gauges are recomputed on every scrape.

| Metric                                    | Type      | Labels              | Meaning                                                                                                                                   |
| ----------------------------------------- | --------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `zombie_process_start_time_seconds`       | gauge     |                     | Process start, for uptime.                                                                                                                |
| `zombie_connections_total`                | counter   |                     | Sockets accepted.                                                                                                                         |
| `zombie_connections_refused_total`        | counter   | `reason`            | Upgrades refused: `server full`, `too many connections from this address`, `origin not allowed`.                                          |
| `zombie_matches_refused_total`            | counter   |                     | `create_match` refused at the room limit.                                                                                                 |
| `zombie_handshakes_total`                 | counter   | `outcome`           | `accepted` or `mismatch` (a client from another protocol version, told to refresh). A burst of mismatches right after a deploy is normal. |
| `zombie_connected_sockets`                | gauge     |                     | Open sockets right now.                                                                                                                   |
| `zombie_messages_rate_limited_total`      | counter   |                     | Messages dropped by the per-socket rate limit.                                                                                            |
| `zombie_messages_malformed_total`         | counter   |                     | Messages that failed protocol decoding.                                                                                                   |
| `zombie_handler_exceptions_total`         | counter   |                     | Handler exceptions (each is an error log line).                                                                                           |
| `zombie_uncaught_exceptions_total`        | counter   |                     | Fatal process errors (the process exits after).                                                                                           |
| `zombie_active_matches`, `zombie_lobbies` | gauge     |                     | Started matches / lobbies held in memory.                                                                                                 |
| `zombie_connected_players`                | gauge     |                     | Player slots with a live socket.                                                                                                          |
| `zombie_matches_started_total`            | counter   |                     | Matches started.                                                                                                                          |
| `zombie_matches_completed_total`          | counter   | `outcome`           | `victory` or `defeat`.                                                                                                                    |
| `zombie_matches_abandoned_total`          | counter   |                     | Matches dropped after the empty grace period.                                                                                             |
| `zombie_matches_restored_total`           | counter   |                     | Matches restored from `STATE_DIR` at startup.                                                                                             |
| `zombie_commands_total`                   | counter   | `outcome`, `reason` | Accepted, or rejected with its `CommandRejectionReason`.                                                                                  |
| `zombie_command_duration_ms`              | histogram | `kind`              | Simulation time per accepted command (`player_only` or `with_zombie_phase`).                                                              |
| `zombie_zombie_phase_duration_ms`         | histogram |                     | Simulation time of commands that ran a zombie phase.                                                                                      |
| `zombie_map_generation_duration_ms`       | histogram |                     | City generation time per `start_match`.                                                                                                   |
| `zombie_map_generation_failures_total`    | counter   |                     | Generator gave up (the host saw `INTERNAL_ERROR`).                                                                                        |
| `zombie_persistence_failures_total`       | counter   |                     | Checkpoint writes to `STATE_DIR` that failed.                                                                                             |
| `zombie_invariant_violations_total`       | counter   | `code`              | Mutations discarded because the resulting state broke an invariant. Alert on any.                                                         |
| `zombie_snapshot_bytes`                   | histogram |                     | Size of one redacted `update` payload.                                                                                                    |
| `zombie_outbound_bytes_total`             | counter   |                     | Bytes of `update` broadcast (payload × recipients).                                                                                       |
| `zombie_reconnect_attempts_total`         | counter   |                     | `rejoin` messages received.                                                                                                               |
| `zombie_reconnect_successes_total`        | counter   |                     | Rejoins that resumed a slot.                                                                                                              |
| `zombie_reconnect_failures_total`         | counter   | `reason`            | Rejoins refused, by error code.                                                                                                           |

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

## Deployment

The unit of deployment is the container image (`Dockerfile`): one Node process serving
the client bundle, the HTTP endpoints, and the WebSocket on `PORT`, running as `node`,
with `/app/state` and `/app/journals` as volumes. TLS terminates at a reverse proxy in
front of it (set `TRUST_PROXY=1` there and nowhere else). `docker-compose.yml` runs it on
a single host; `.env.example` lists the runtime configuration. Secrets (`ADMIN_TOKEN`)
and the origin allowlist come from the environment or the host's secret store at run
time; the image contains none of them and the source tree contains no `.env`.

Build and tag by the commit, so the tag, `/version`, and the startup log agree:

```sh
GAME_VERSION=0.1.0+$(git rev-parse --short HEAD) SOURCE_REVISION=$(git rev-parse HEAD)
docker build --build-arg GAME_VERSION --build-arg SOURCE_REVISION -t zombie:$GAME_VERSION .
```

CI builds the same image on every commit and starts it to read `/version`, so a tag that
reached the registry has already booted once.

Deploy, in this order, to staging first and then to production:

1. Start the new image beside the old one or replace it (a single host: `docker compose
up -d`; the old container gets SIGTERM, drains, and exits; players reconnect to the new
   one within seconds and rejoin their matches from the shared state volume).
2. `GET /version` must show the new `gameVersion` and `sourceRevision`; `GET /readyz`
   must be 200.
3. Run the smoke test against the deployment:
   `pnpm --filter @zombie/server smoke -- --url wss://host` (handshake, lobby, match
   start, one accepted command, reconnect with a token; exit 0 or the failing step).
4. Watch the signals below for fifteen minutes before calling it done.

A deployment that changes `PROTOCOL_VERSION` disconnects every loaded client once; they
show "The game has been updated. Refresh to continue." and a refresh rejoins their match.
A deployment that changes `SIMULATION_VERSION` cannot restore the previous build's active
matches (`match not restorable` at startup, records discarded): announce it, or deploy
when no match is running.

## Rollback

Rolling back is deploying the previous image tag the same way. What carries over:

- **Active matches** in the state volume are restored by the older build as long as the
  simulation version matches; across a simulation bump they are discarded (as above).
- **Players** rejoin with their stored tokens; across a protocol bump they refresh once.
- **Journals** already written are kept; the older build refuses to replay newer ones.

Roll back, or disable the release behind the proxy, when any of these holds after a
deploy and did not before:

| Signal                                                            | Threshold                                     |
| ----------------------------------------------------------------- | --------------------------------------------- |
| process restarts (`uncaught exception` / container exits)         | more than one in ten minutes                  |
| `zombie_handler_exceptions_total`                                 | any increase                                  |
| `zombie_invariant_violations_total`                               | any increase                                  |
| `match not restorable` at startup                                 | any, without a simulation bump in the release |
| `zombie_reconnect_failures_total{reason="INVALID_REJOIN_TOKEN"}`  | a rate visibly above the pre-deploy baseline  |
| `zombie_command_duration_ms{kind="with_zombie_phase"}` p99        | above 50 ms sustained (docs/PERFORMANCE.md)   |
| `/readyz` not 200 after the start-up period                       | at all                                        |
| players reporting they cannot join or their turn does not advance | two independent reports                       |

The rollback procedure was rehearsed with two bundles built from the same commit
(`GAME_VERSION` `0.1.0+a` and `0.1.0+b`) run as processes on one shared `STATE_DIR`:
`/version`, `/healthz`, and `/readyz` answered; the smoke test passed all six steps
against `b`; SIGTERM drained two active matches and exited 0 in under ten milliseconds
with `shutdown complete` in the log; `a` restored both matches from the directory at
their revisions and a player rejoined with the stored token and received the current
snapshot; a client from before the handshake was refused with the refresh text and close
code 1008. The container build is verified by the CI container job on every commit;
repeat the same rehearsal with the image on the staging host before the first invited
playtest.

## Logs in production

Logs are JSON lines on stdout and stderr; ship them with the platform's collector (the
compose file uses the json-file driver with rotation; a `docker logs`, `journalctl`, or
any log shipper that reads container output works). Keep at least `error` lines and
every `match ended`, `match restored`, and `version mismatch` line for a week: together
with the match code they locate any reported problem, and the journal in `JOURNAL_DIR`
(or the record in `STATE_DIR`) replays it. Crashes are the `uncaught exception` line
(stack included) followed by the container's restart; there is no third-party crash
reporter, and one is not needed while the log stream is collected.

## Staged playtests

1. **Internal** (the team, one host, `INVARIANT_CHECKS=full`, `LOG_LEVEL=debug`): every
   scenario and party size at least once; a refresh mid-turn, a closed laptop for ten
   minutes, a deliberate `docker stop` mid-match; the soak running against the same host
   at the same time. Exit criterion: nothing in the rollback table fires for a day.
2. **Invited group** (tens of players, production configuration, `ALLOWED_ORIGINS` set):
   share the code by hand; watch `zombie_active_matches`, reconnect failures, and the
   admin match list for stuck rounds (`/admin/matches` with a revision that stops moving
   while players are connected). Collect journals of any match players call unfair.
   Exit criterion: no rollback trigger, and every reported problem reproduces from its
   journal.
3. **Wider population**: raise `MAX_MATCHES` and `MAX_CONNECTIONS` to the measured host
   capacity (docs/PERFORMANCE.md), keep `INVARIANT_CHECKS=critical`, and keep the
   nightly soak green.

## Public playtest readiness checklist

| Ready when                                                           | Verified by                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| players refresh or reconnect without losing identity within policy   | `server.test.ts` "presence", `multiplayer.test.ts`, the soak's rejoins, ADR 0007                                                       |
| old loaded clients are cleanly rejected after an incompatible deploy | `server.test.ts` "version handshake"; the rollback rehearsal's old-client probe                                                        |
| a failed match can be located from logs and its journal              | every command line carries `matchCode` and `commandId`; journals named `<matchId>-<seed>.json`; `docs/DEVELOPMENT.md` "Replay a match" |
| critical invariants and multiplayer tests pass                       | `pnpm check` (game-core invariants, `multiplayer.test.ts`, `soak.test.ts`) and CI on every commit                                      |
| abandoned rooms expire                                               | `multiplayer.test.ts` "whole-party disconnect", `lifecycle.test.ts`; 10-minute grace in production                                     |
| server shutdown is tested                                            | `lifecycle.test.ts` "graceful shutdown"; the `docker stop` in the rollback rehearsal                                                   |
| basic abuse controls are active                                      | `security.test.ts`; `ALLOWED_ORIGINS` set and the limits logged at startup                                                             |
| rollback procedure has been tested at least once                     | the rehearsal above; repeat it on the staging host before the first invited playtest                                                   |
