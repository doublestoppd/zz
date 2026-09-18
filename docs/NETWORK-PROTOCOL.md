# Network protocol

Transport: one WebSocket per client, text frames containing JSON. Types live in
`packages/protocol/src/messages.ts`; that file is the source of truth and this document
follows its order. `PROTOCOL_VERSION` is 2.

Principles:

- The client sends **intent**, never outcomes. A move names a destination; the server
  computes the path, the cost, and the new state.
- The server stamps `playerId` from the session. A `playerId` in a client payload is ignored.
- Every accepted command results in an `update` with the **full** state to everyone in the
  match. Rejections go to the sender only.
- Session-level problems are `error`; gameplay problems are `rejected`. A client can tell
  them apart by `t`.

## Client → server

### `create_match`

```json
{ "t": "create_match", "playerName": "Ann", "specialty": "paramedic" }
```

Creates a lobby; the sender becomes host. Validation: name 1–20 printable characters,
`specialty` (optional, default `survivor`) one of the known specialties, sender not
already in a match. Response: `joined`, then `lobby` to everyone (the sender).
Errors: `INVALID_PLAYER_NAME`, `ALREADY_IN_MATCH`.

### `join_match`

```json
{ "t": "join_match", "matchCode": "QMCN", "playerName": "Bob", "specialty": "athlete" }
```

Validation: code exists, lobby not started, fewer than 4 members, valid name, known
specialty (optional, default `survivor`), sender not in a match. Response: `joined` to the sender, `lobby` to everyone.
Errors: `MATCH_NOT_FOUND`, `MATCH_ALREADY_STARTED`, `MATCH_FULL`, `INVALID_PLAYER_NAME`, `ALREADY_IN_MATCH`.

### `set_specialty`

```json
{ "t": "set_specialty", "specialty": "mechanic" }
```

Changes the sender's specialty while the lobby has not started. Response: `lobby` to
everyone (each `LobbyPlayer` carries its `specialty`). Errors: `NOT_IN_MATCH`,
`MATCH_ALREADY_STARTED`.

### `rejoin_match`

```json
{ "t": "rejoin_match", "matchCode": "QMCN", "rejoinToken": "…" }
```

Reattaches a new socket to the slot whose token matches. The client sends this on its own
whenever a socket opens while it remembers a slot from `joined`. Any older socket on that slot receives
`error SESSION_REPLACED` and is closed (1008), so a second tab visibly takes over from the
first. Response: `joined`, `lobby` to everyone, and if the match has started an `update`
with the latest snapshot (the player is marked present; the resulting events go to
everyone). Errors: `MATCH_NOT_FOUND`, `INVALID_REJOIN_TOKEN`, `ALREADY_IN_MATCH`.

### `start_match`

Host only. `scenario` (optional, default `extraction`) picks the scenario from the
known list.

```json
{ "t": "start_match" }
```

Host only, lobby only. Response: `lobby` (with `started: true`) and `update` (version 0) to
everyone. Errors: `NOT_IN_MATCH`, `MATCH_ALREADY_STARTED`, `NOT_HOST`.

### `command`

```json
{ "t": "command", "commandId": "6f1c…", "baseRevision": 3, "command": { "type": "move", "to": { "x": 3, "y": 1 } } }
{ "t": "command", "commandId": "8a20…", "baseRevision": 4, "command": { "type": "fire_weapon", "targetId": "z1" } }
{ "t": "command", "commandId": "9b31…", "baseRevision": 4, "command": { "type": "melee_attack", "targetId": "z1" } }
{ "t": "command", "commandId": "c4d2…", "baseRevision": 5, "command": { "type": "reload" } }
{ "t": "command", "commandId": "d5e3…", "baseRevision": 6, "command": { "type": "pick_up", "itemId": "i3" } }
{ "t": "command", "commandId": "e6f4…", "baseRevision": 7, "command": { "type": "use_item", "itemType": "medkit" } }
{ "t": "command", "commandId": "f7a5…", "baseRevision": 8, "command": { "type": "search", "containerId": "c4" } }
{ "t": "command", "commandId": "0b86…", "baseRevision": 9, "command": { "type": "open_door", "barrierId": "b2" } }
{ "t": "command", "commandId": "1c97…", "baseRevision": 10, "command": { "type": "close_door", "barrierId": "b2" } }
{ "t": "command", "commandId": "2da8…", "baseRevision": 11, "command": { "type": "force_entry", "barrierId": "b7" } }
{ "t": "command", "commandId": "3eb9…", "baseRevision": 8, "command": { "type": "end_turn" } }
```

`commandId` is chosen by the client, 1 to 64 characters of `[A-Za-z0-9_-]` (the browser
client uses a UUID), unique per command. `baseRevision` is the `update.revision` the client
acted on. Response: `update` carrying the `commandId` to everyone, or `rejected` to the
sender. See "Command reliability" below for the pipeline. Session-level errors:
`NOT_IN_MATCH` (the socket occupies no player slot).

### `resync`

```json
{ "t": "resync" }
```

Ask for a fresh authoritative snapshot: the server answers this socket with `map` and then
`update` (no `commandId`). The browser client sends it after a `STALE_REVISION` rejection.
Errors: `NOT_IN_MATCH`, `MATCH_NOT_STARTED`.

### `leave_match`

```json
{ "t": "leave_match" }
```

Treated exactly like a socket close: in a lobby the slot is released (host passes to the
next member); in a running match the player is marked absent and may rejoin.

## Server → client

### `joined`

```json
{
  "t": "joined",
  "protocolVersion": 3,
  "matchCode": "QMCN",
  "playerId": "QMCN-p1",
  "rejoinToken": "…"
}
```

Store `rejoinToken`; it is the only credential for `rejoin_match`.

### `lobby`

```json
{
  "t": "lobby",
  "matchCode": "QMCN",
  "hostId": "QMCN-p1",
  "maxPlayers": 4,
  "started": false,
  "players": [{ "id": "QMCN-p1", "name": "Ann", "specialty": "survivor", "present": true }]
}
```

Sent to everyone on any membership or presence change, before and after start.

### `map`

```json
{ "t": "map", "map": { "width": 26, "height": 18, "tiles": [ [ …Tile… ] ] } }
```

The static board, sent to every socket once before its first `update`: to everyone when
the host starts the match, and to a rejoining socket before its snapshot. It never changes
during a match; a client that receives an `update` before a `map` ignores the update.

### `update`

```json
{ "t": "update", "revision": 3, "commandId": "6f1c…", "state": { …GameState… }, "events": [ …GameEvent… ] }
```

`state` is the authoritative `GameState` from `packages/game-core` minus its `map`, which the
client already holds from the `map` message; the client joins the two. `revision` is the
authoritative state revision (see "Command reliability"); discard an update whose revision
is lower than the last one applied. `commandId` names the accepted command that produced
the update and is absent for server-originated updates (presence changes, a `resync`
snapshot, the first snapshot at start). The snapshot is redacted for fog of war: `zombies`
holds only the zombies inside the team's current view, and zombie events out of view are
dropped (see `apps/server/src/match/redact.ts`). `events` describe what produced this state
(see `events/types.ts`); they drive logs and animation and are never required to rebuild the
board.

### `rejected`

```json
{ "t": "rejected", "commandId": "6f1c…", "reason": "INVALID_ACTION", "detail": "INSUFFICIENT_ACTION_POINTS", "currentRevision": 3 }
{ "t": "rejected", "commandId": "8a20…", "reason": "STALE_REVISION", "currentRevision": 5 }
{ "t": "rejected", "commandId": "9b31…", "reason": "MALFORMED_COMMAND" }
```

The typed outcome of a command that was not executed; sent to the sender only. `reason` is
one of the closed set `MALFORMED_COMMAND`, `NOT_AUTHORIZED`, `MATCH_NOT_STARTED`,
`DUPLICATE_COMMAND`, `STALE_REVISION`, `INVALID_PHASE`, `INVALID_ACTION`. For the last two,
`detail` carries the game-core `RejectionReason` (`NOT_YOUR_TURN`, `MAGAZINE_FULL`, …) so the
client can word it. `currentRevision` is the server's revision when it answered; it is
absent only for `MALFORMED_COMMAND`, which is answered before any match is looked up.

### `error`

```json
{ "t": "error", "code": "NOT_HOST", "message": "Only the host can do that." }
```

Session-level problems, never the outcome of a gameplay command. Codes: `MALFORMED_MESSAGE`,
`INVALID_PLAYER_NAME`, `MATCH_NOT_FOUND`, `MATCH_FULL`, `MATCH_ALREADY_STARTED`,
`MATCH_NOT_STARTED`, `NOT_IN_MATCH`, `ALREADY_IN_MATCH`, `NOT_HOST`, `INVALID_REJOIN_TOKEN`,
`RATE_LIMITED`, `SESSION_REPLACED`, `INTERNAL_ERROR` (a handler threw; the message was not
applied; nothing about the exception is sent). `MALFORMED_MESSAGE` covers invalid JSON,
unknown `t`, and wrong field types in the envelope; a well-formed `command` envelope with a
bad body is answered with `rejected MALFORMED_COMMAND` instead. `message` is fixed text per
code, safe to show.

## Command reliability

Every gameplay command passes through the same pipeline, in this order, and every step
either forwards it or answers the sender with a typed outcome:

```
socket text
  -> runtime validation          protocol.decodeClientMessage: MALFORMED_MESSAGE / rejected MALFORMED_COMMAND
  -> rate limit                  error RATE_LIMITED (socket layer, before decoding)
  -> session / ownership         error NOT_IN_MATCH; the playerId is stamped from the session, never read from the payload
  -> match started               rejected MATCH_NOT_STARTED
  -> duplicate commandId         rejected DUPLICATE_COMMAND (the command is not executed again)
  -> baseRevision check          rejected STALE_REVISION with currentRevision
  -> game rules                  rejected INVALID_PHASE / INVALID_ACTION / NOT_AUTHORIZED with detail
  -> authoritative mutation      revision += 1
  -> update { revision, commandId, state, events } to everyone
```

**Revision rule.** The revision is 0 when the match starts and increases by exactly one for
every accepted mutation of the authoritative state, whether a player command or a server
command (a presence change on connect or disconnect). Nothing else changes it. A rejected
command never changes it.

**Duplicates.** The server keeps the last 256 command ids per player, with the player and
not the socket, so a retransmission after a reconnect is still recognised. A duplicate is
answered but never executed; the client treats the answer as settled because the original
outcome already arrived as an `update` (or will, in order).

**Stale commands and resynchronisation.** A command whose `baseRevision` is not the
server's current revision is refused as `STALE_REVISION`. The client then sends `resync`
and rebuilds from the snapshot it gets back. Because every `update` is a complete snapshot,
a client that missed one is behind only until the next update or resync; it is never
inconsistent. The client keeps at most one command pending, so it never sends a command
against a revision it has not seen.

## Limits

Applied by the socket layer before any message is read: text frames larger than 16 KB close
the socket (code 1009); more than 200 concurrent connections are refused (1013); each socket
may send a burst of 20 messages and then 10 per second, beyond which messages are dropped
with `error RATE_LIMITED` and a client that keeps flooding is closed (1008); the server pings
every 30 seconds and terminates a socket that did not answer the previous ping.

## Lifecycle

- A lobby with no connected members is deleted immediately.
- A started match with no connected members is kept for 10 minutes
  (`ABANDONED_MATCH_TTL_MS`) so players can rejoin, then deleted.
