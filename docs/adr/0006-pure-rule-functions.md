# 0006 — Rules as pure functions returning new state and events

Status: accepted

## Context

Rules must be testable without a server or browser, and the server must be able to apply a
command, inspect the result, and decide what to broadcast.

## Decision

`applyCommand(state, command)` and the phase functions in `turn/` are pure: they never
mutate their input and return `{ state, events }` or a typed rejection. Shared checks
(`requireActivePlayer`) and board rules (`validateMove`) are separate pure functions so
each can be tested and reused.

## Alternatives considered

- Mutating a state object in place: shorter code, but tests must clone defensively and the
  server cannot compare before and after.
- A class per entity with behaviour methods: conflicts with plain-data state (ADR 0002)
  and spreads rules across many files.

## Consequences

- Tests read as `expect(applyCommand(state, cmd)).toEqual(...)`.
- Determinism tests are trivial (run twice, compare).
- Nested updates are verbose; small helpers (`replacePlayer`) keep them readable.
