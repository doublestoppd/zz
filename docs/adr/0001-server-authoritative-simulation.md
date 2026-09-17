# 0001 — Server-authoritative simulation

Status: accepted

## Context

A cooperative multiplayer game needs one source of truth for positions, action points,
and later damage and loot. Clients are untrusted and may be buggy, laggy, or modified.

## Decision

The server holds the only authoritative `GameState`. Clients send intent (`move` to a
destination, `end_turn`); the server validates through `game-core`, applies the change, and
broadcasts the resulting state. The player id on every command comes from the server-side
session, never from the client payload.

## Alternatives considered

- Client-authoritative with server relay: simplest, but any client can cheat or desync,
  and bugs are irreproducible.
- Lockstep peer simulation: deterministic but every client must run the rules and agree;
  reconnection and late joins become hard.

## Consequences

- Every rule must exist on the server; the client may mirror rules for UX (highlighting
  legal moves) but its answers are never trusted.
- Latency is visible as a round trip per action, acceptable for a turn-based game.
- `game-core` must be pure and framework-free so the server can run it headlessly and
  tests can run it without a server.
