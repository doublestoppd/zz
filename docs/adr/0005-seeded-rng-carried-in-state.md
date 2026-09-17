# 0005 — Seeded randomness with the cursor stored in GameState

Status: accepted

## Context

Procedural maps, zombie behaviour, and combat will use randomness. Multiplayer bugs are
only fixable if a match can be replayed exactly.

## Decision

`game-core` exposes an `Rng` interface with a small deterministic implementation
(mulberry32). Authoritative functions take an `Rng` parameter; `Math.random` is banned by
lint in `game-core` and `map-generation`. The generator's 32-bit state is stored in
`GameState.rngState`, and any function that consumes randomness writes the new cursor
back. The match `seed` derives independent streams for gameplay and map generation.

## Alternatives considered

- Seed only, cursor implicit: replay from the start works, but a mid-match snapshot cannot
  be resumed deterministically.
- Rng held by the server outside the state: same problem, and it hides a dependency.
- A third-party PRNG package: not needed for ten lines of code.

## Consequences

- Any `update` payload is a complete reproduction: state plus subsequent commands.
- Phase functions have an extra obligation (write back the cursor), documented on
  `resolveZombiePhase` and checked by tests once randomness is used.
