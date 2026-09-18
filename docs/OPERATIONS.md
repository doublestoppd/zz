# Operations

How to run, configure, stop, and recover the game server. Deployment and rollback are in
their own section at the end (filled in by the deployment milestone).

## Configuration

All configuration is by environment variable; nothing is read from files in the source
tree and no secret is committed.

| Variable       | Default        | Meaning                                                                             |
| -------------- | -------------- | ----------------------------------------------------------------------------------- |
| `PORT`         | `8080`         | HTTP and WebSocket port.                                                            |
| `STATIC_DIR`   | unset          | Serve the built client from this directory on the same port.                        |
| `STATE_DIR`    | unset (memory) | Match records for restart recovery; one JSON file per match. Private: holds tokens. |
| `JOURNAL_DIR`  | unset          | Finished-match journals for bug reports and replay verification.                    |
| `GAME_VERSION` | `0.1.0-dev`    | Human-facing build label, logged at startup and recorded in journals.               |

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

One JSON object per line on stdout (info) or stderr (error), with `time`, `level`,
`message`, and structured fields: `matchCode`, `playerId`, `commandId`, `revision`, `seed`,
`reason`. Rejoin tokens are never logged. Command outcomes are logged at info; a rejected
command is normal play, not an error.

## Health

`GET /healthz` answers `{"ok":true}` while the listener is up.

## Cleanup

- Abandoned matches delete their record automatically.
- Completed records are swept 24 hours after their last save, on the next startup.
- Journals in `JOURNAL_DIR` are never deleted by the server; rotate them with the host's
  tools.
