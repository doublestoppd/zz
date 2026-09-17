# 0002 — Plain-data state and full-snapshot synchronisation

Status: accepted

## Context

State must travel over the wire, be stored for replay, and be built in tests by hand.
The state is small (about 27 KB with a generated 26x18 map, of which the map is 93%) and
changes only when a player acts.

## Decision

`GameState` is plain JSON-serialisable data: arrays and objects only, no classes, `Map`,
`Set`, functions, or framework objects. The server sends the whole state in every `update`,
with an increasing `version`. Clients render from the latest snapshot; events are extra.

## Alternatives considered

- Delta or patch sync (Colyseus schema, JSON patch): less bandwidth, but adds a divergence
  class of bugs and a mapping layer between domain state and wire state.
- Class-based entities with methods: convenient in code, but not serialisable and hard to
  build in tests.

## Amendment (audit follow-up)

The static map is 93% of a snapshot, so it is now sent once per socket in a `map` message
and `update` carries the rest (about 2 KB). The client reassembles `GameState` locally;
everything else in this decision stands.

## Consequences

- `JSON.stringify` is the serialiser. Reconnection is "send the latest snapshot".
- Immutable updates are written by hand (`{ ...state, players: ... }`) with small helpers
  such as `replacePlayer`. Revisit (for example with immer) only if update code becomes
  error-prone.
- Should state grow large or updates frequent, delta sync can be added inside
  `packages/protocol` without touching `game-core`.
