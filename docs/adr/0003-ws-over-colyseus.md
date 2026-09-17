# 0003 — Plain WebSockets with a hand-written protocol, not Colyseus

Status: accepted

## Context

The server needs rooms (lobbies), sessions, and message delivery. Colyseus provides all of
these plus delta-synchronised state; a raw WebSocket library provides only delivery.

## Decision

Use the `ws` library on the server and the browser's native `WebSocket` on the client, with
JSON messages defined and validated in `packages/protocol`. Lobby, sessions, rejoin tokens,
and broadcasting are written by hand in `apps/server` (a few hundred lines).

## Alternatives considered

- Colyseus: rooms and matchmaking for free, but its `@colyseus/schema` wants decorated class
  state, which conflicts with ADR 0002 and would need a mapping layer. It also brings a
  larger dependency surface than a turn-based game needs.
- Socket.IO: adds its own framing and reconnection semantics without reducing our code.

## Consequences

- Every message is explicit, typed, decoded by a visible guard, and documented.
- `net/socketServer.ts` is the only file importing `ws`; swapping the transport later
  touches that file and the `GameConnection` client wrapper.
- Reconnection is our responsibility: implemented as rejoin tokens and presence flags.
