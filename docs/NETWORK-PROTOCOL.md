# Network protocol

Transport: one WebSocket per client, text frames containing JSON. Types live in
`packages/protocol/src/messages.ts`; that file is the source of truth and this document
follows its order. `PROTOCOL_VERSION` is 5.

Principles:

- The client sends **intent**, never outcomes. A move names a destination; the server
  computes the path, the cost, and the new state.
- The server stamps `playerId` from the session. A `playerId` in a client payload is ignored.
- Every accepted command results in an `update` with the **full** state to everyone in the
  match. Rejections go to the sender only.
- Session-level problems are `error`; gameplay problems are `rejected`. A client can tell
  them apart by `t`.

## Handshake

The first message on every socket is `hello`; the server answers `welcome` or refuses.

```json
{ "t": "hello", "protocolVersion": 5, "gameVersion": "0.8.2" }
{ "t": "welcome", "protocolVersion": 5, "gameVersion": "0.8.2", "simulationVersion": 1 }
```

Compatibility is protocol-version equality, nothing else: `gameVersion` is a build label
for logs and the status line, and `simulationVersion` says which deterministic rules the
server runs (journals record it; replays of another version are refused). A different
`protocolVersion`, or any other message before `hello` (a client loaded before the
handshake existed), is answered with `error VERSION_MISMATCH` ("The game has been
updated. Refresh to continue.") and the socket closes with code 1008. The client then
stops reconnecting and shows that text; a reload loads the current build. Historical
client versions are not supported on purpose ([ADR 0015](adr/0015-versioning.md)).

## Client → server

### `hello`

See the handshake above. `protocolVersion` is a non-negative integer, `gameVersion` at
most 64 characters. Sending it again after `welcome` is answered with another `welcome`.

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

Reattaches a new socket to the slot whose token matches; the socket must not already be in
a match. The client sends this on its own whenever a socket opens while it remembers a slot
from `joined` (a refresh is a reconnect, never a new player). Any older socket on that slot
receives `error SESSION_REPLACED` and is closed (1008), so a second tab visibly takes over
from the first. Response: `joined` (with `rejoined: true` and `matchStarted`), `lobby` to
everyone, and if the match has started a `map` and an `update` whose revision includes the
presence change. The client must rebuild its presentation from that snapshot. Works in a
lobby, a running match (whatever the phase; the server is never between phases), and a
finished match. Errors: `MATCH_NOT_FOUND`, `INVALID_REJOIN_TOKEN`, `ALREADY_IN_MATCH`.

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
  "protocolVersion": 5,
  "matchCode": "QMCN",
  "playerId": "QMCN-p1",
  "rejoinToken": "…",
  "rejoined": false,
  "matchStarted": false
}
```

Store `rejoinToken`; it is the only credential for `rejoin_match`, it is never logged by
the server, and it is not derivable from the public `playerId`. `rejoined` is true when
the socket reattached to an existing slot; `matchStarted` tells the client to expect a
`map` and `update` next.

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
`VERSION_MISMATCH` (see the handshake; the socket closes after it),
`RATE_LIMITED` (also answered to a join or rejoin from an address that made too many
failed lookups in the last minute), `SESSION_REPLACED`, `SHUTTING_DOWN` (the server is
draining: no lobby can be created or joined; connected players receive it just before their
socket closes with code 1001 and should reconnect), `SERVER_FULL` (the room limit is
reached; try again later), `INTERNAL_ERROR` (a handler threw, or the state a command
produced failed an invariant; the message was not applied; nothing about the cause is
sent). `MALFORMED_MESSAGE` covers invalid JSON,
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

At the HTTP upgrade, before a socket exists: a browser `Origin` outside the configured
allowlist is refused with 403 (no list configured: any origin); more than 200 concurrent
connections (configurable) are refused with 503; more than 16 sockets from one address
(configurable) with 429. A refused upgrade costs one HTTP response and never reaches a
handler.

By the socket layer before any message is read: text frames larger than 16 KB close the
socket (code 1009); each socket may send a burst of 20 messages and then 10 per second,
beyond which messages are dropped with `error RATE_LIMITED` and a client that keeps
flooding is closed (1008); the server pings every 30 seconds and terminates a socket that
did not answer the previous ping.

By the decoders: every client-supplied string is bounded. Entity ids (`targetId`,
`itemId`, `containerId`, `barrierId`) are 1 to 64 characters, `commandId` 1 to 64 of
`[A-Za-z0-9_-]`, `matchCode` 1 to 16, `rejoinToken` 1 to 128, a raw player name 1 to 200
(the lobby then trims it and applies its own 1 to 20 rule). Anything longer is
`MALFORMED_MESSAGE` or `rejected MALFORMED_COMMAND`, exactly like a wrong type.

By the lobby: at most 100 lobbies and matches per process (configurable; `SERVER_FULL`
beyond it), one lobby per socket, and ten failed lookups (unknown code or wrong rejoin
token) per address per minute before joins from that address are `RATE_LIMITED` for the
rest of the minute. See `docs/SECURITY.md` for what each limit is for.

## Lifecycle and reconnect policy

| Situation                             | Behaviour                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Active player disconnects             | Marked absent (a revision-bumping mutation); the turn passes at once; they are skipped until they return.       |
| Disconnect during zombie or end phase | Cannot happen from the server's view: those phases resolve inside the command that ends the last turn.          |
| Refresh                               | A reconnect: the stored token restores the same player, body, inventory, and position.                          |
| Duplicate session                     | The newest socket wins; the older gets `SESSION_REPLACED` and is closed.                                        |
| Per-player grace                      | Unlimited within the match; the slot is never removed, forfeited, or taken over.                                |
| Whole party disconnects               | A started match is kept 10 minutes (`ABANDONED_MATCH_TTL_MS`), then deleted; an empty lobby is deleted at once. |
| Match finished                        | Rejoin still returns the final snapshot; gameplay commands are refused (`INVALID_PHASE`).                       |

See [ADR 0007](../docs/adr/0007-session-identity-and-reconnect-policy.md) for the reasoning.
