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
{ "t": "create_match", "playerName": "Ann" }
```

Creates a lobby; the sender becomes host. Validation: name 1–20 printable characters,
sender not already in a match. Response: `joined`, then `lobby` to everyone (the sender).
Errors: `INVALID_PLAYER_NAME`, `ALREADY_IN_MATCH`.

### `join_match`

```json
{ "t": "join_match", "matchCode": "QMCN", "playerName": "Bob" }
```

Validation: code exists, lobby not started, fewer than 4 members, valid name, sender not in a
match. Response: `joined` to the sender, `lobby` to everyone.
Errors: `MATCH_NOT_FOUND`, `MATCH_ALREADY_STARTED`, `MATCH_FULL`, `INVALID_PLAYER_NAME`, `ALREADY_IN_MATCH`.

### `rejoin_match`

```json
{ "t": "rejoin_match", "matchCode": "QMCN", "rejoinToken": "…" }
```

Reattaches a new socket to the slot whose token matches. The client sends this on its own
whenever a socket opens while it remembers a slot from `joined`. Any older socket on that slot is
detached. Response: `joined`, `lobby` to everyone, and if the match has started an `update`
with the latest snapshot (the player is marked present; the resulting events go to
everyone). Errors: `MATCH_NOT_FOUND`, `INVALID_REJOIN_TOKEN`, `ALREADY_IN_MATCH`.

### `start_match`

```json
{ "t": "start_match" }
```

Host only, lobby only. Response: `lobby` (with `started: true`) and `update` (version 0) to
everyone. Errors: `NOT_IN_MATCH`, `MATCH_ALREADY_STARTED`, `NOT_HOST`.

### `command`

```json
{ "t": "command", "seq": 12, "expectedVersion": 3, "command": { "type": "move", "to": { "x": 3, "y": 1 } } }
{ "t": "command", "seq": 13, "expectedVersion": 4, "command": { "type": "fire_weapon", "targetId": "z1" } }
{ "t": "command", "seq": 14, "expectedVersion": 5, "command": { "type": "reload" } }
{ "t": "command", "seq": 15, "expectedVersion": 6, "command": { "type": "pick_up", "itemId": "i3" } }
{ "t": "command", "seq": 16, "expectedVersion": 7, "command": { "type": "use_item", "itemType": "medkit" } }
{ "t": "command", "seq": 17, "expectedVersion": 8, "command": { "type": "end_turn" } }
```

`seq` is chosen by the client and must increase with every command on the same socket; a
`seq` at or below the last one the server accepted is answered with `error DUPLICATE_COMMAND`
(carrying that `seq`) and ignored. The sequence starts over on each new socket, so a rejoin
begins at 1 again. `expectedVersion` is the `update.version` the client acted on; if the
server's current version differs, the command is answered with `error STALE_STATE` and
ignored, and the client should re-read the latest snapshot before acting. Both guards run
before any game rule. The client keeps at most one command pending. Coordinates must be
integers. Response: `update` to everyone, or `rejected` to the sender. Errors:
`NOT_IN_MATCH`, `MATCH_NOT_STARTED`, `DUPLICATE_COMMAND`, `STALE_STATE`.

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
  "protocolVersion": 1,
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
  "players": [{ "id": "QMCN-p1", "name": "Ann", "present": true }]
}
```

Sent to everyone on any membership or presence change, before and after start.

### `update`

```json
{ "t": "update", "version": 3, "state": { …GameState… }, "events": [ …GameEvent… ] }
```

`state` is the complete authoritative `GameState` from `packages/game-core`. `version`
increases by one per accepted command; discard an update whose version is lower than the
last one seen. `events` describe what produced this state (see `events/types.ts`); they
drive logs and animation and are never required to rebuild the board.

### `rejected`

```json
{ "t": "rejected", "seq": 12, "reason": "INSUFFICIENT_ACTION_POINTS" }
```

`reason` is a `RejectionReason` from game-core. Sent to the sender only.

### `error`

```json
{ "t": "error", "code": "NOT_HOST", "message": "Only the host can do that." }
```

Codes: `MALFORMED_MESSAGE`, `INVALID_PLAYER_NAME`, `MATCH_NOT_FOUND`, `MATCH_FULL`,
`MATCH_ALREADY_STARTED`, `MATCH_NOT_STARTED`, `NOT_IN_MATCH`, `ALREADY_IN_MATCH`, `NOT_HOST`,
`INVALID_REJOIN_TOKEN`. `MALFORMED_MESSAGE` covers invalid JSON, unknown `t`, unknown command
types, and wrong field types; the connection stays open.

## Lifecycle

- A lobby with no connected members is deleted immediately.
- A started match with no connected members is kept for 10 minutes
  (`ABANDONED_MATCH_TTL_MS`) so players can rejoin, then deleted.
