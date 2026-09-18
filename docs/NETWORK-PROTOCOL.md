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
{ "t": "command", "seq": 12, "expectedVersion": 3, "command": { "type": "move", "to": { "x": 3, "y": 1 } } }
{ "t": "command", "seq": 13, "expectedVersion": 4, "command": { "type": "fire_weapon", "targetId": "z1" } }
{ "t": "command", "seq": 22, "expectedVersion": 4, "command": { "type": "melee_attack", "targetId": "z1" } }
{ "t": "command", "seq": 14, "expectedVersion": 5, "command": { "type": "reload" } }
{ "t": "command", "seq": 15, "expectedVersion": 6, "command": { "type": "pick_up", "itemId": "i3" } }
{ "t": "command", "seq": 16, "expectedVersion": 7, "command": { "type": "use_item", "itemType": "medkit" } }
{ "t": "command", "seq": 18, "expectedVersion": 8, "command": { "type": "search", "containerId": "c4" } }
{ "t": "command", "seq": 19, "expectedVersion": 9, "command": { "type": "open_door", "barrierId": "b2" } }
{ "t": "command", "seq": 20, "expectedVersion": 10, "command": { "type": "close_door", "barrierId": "b2" } }
{ "t": "command", "seq": 21, "expectedVersion": 11, "command": { "type": "force_entry", "barrierId": "b7" } }
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

### `map`

```json
{ "t": "map", "map": { "width": 26, "height": 18, "tiles": [ [ …Tile… ] ] } }
```

The static board, sent to every socket once before its first `update`: to everyone when
the host starts the match, and to a rejoining socket before its snapshot. It never changes
during a match; a client that receives an `update` before a `map` ignores the update.

### `update`

```json
{ "t": "update", "version": 3, "state": { …GameState… }, "events": [ …GameEvent… ] }
```

`state` is the authoritative `GameState` from `packages/game-core` minus its `map`, which the
client already holds from the `map` message; the client joins the two. `version`
increases by one per accepted command; discard an update whose version is lower than the
last one seen. The snapshot is redacted for fog of war: `zombies` holds only the zombies
inside the team's current view, and zombie events out of view are dropped (see
`apps/server/src/match/redact.ts`). `events` describe what produced this state (see `events/types.ts`); they
drive logs and animation and are never required to rebuild the board.

### `rejected`

```json
{ "t": "rejected", "seq": 12, "reason": "INSUFFICIENT_ACTION_POINTS" }
```

`reason` is a `RejectionReason` from game-core. Sent to the sender only.

### `error`

```json
{ "t": "error", "code": "NOT_HOST", "message": "Only the host can do that." }
{ "t": "error", "code": "STALE_STATE", "message": "The board changed before your command arrived. Try again.", "seq": 12 }
```

Codes: `MALFORMED_MESSAGE`, `INVALID_PLAYER_NAME`, `MATCH_NOT_FOUND`, `MATCH_FULL`,
`MATCH_ALREADY_STARTED`, `MATCH_NOT_STARTED`, `NOT_IN_MATCH`, `ALREADY_IN_MATCH`, `NOT_HOST`,
`INVALID_REJOIN_TOKEN`, `DUPLICATE_COMMAND`, `STALE_STATE`, `RATE_LIMITED`,
`SESSION_REPLACED`, `INTERNAL_ERROR` (a handler threw; the message was not applied). `seq` is
present
when the error answers a specific command. `MALFORMED_MESSAGE` covers invalid JSON, unknown
`t`, unknown command types, and wrong field types; the connection stays open.

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
