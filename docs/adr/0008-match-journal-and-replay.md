# ADR 0008: Match journal and replay source of truth

## Status

Accepted (engineering milestone M).

## Context

Multiplayer bugs are reported as "something went wrong in round 9". The simulation is
already deterministic (seeded RNG carried in the state, pure rules, no wall clock), so a
match should be reproducible from what created it plus what was done to it.

## Decision

- **Commands are the source of truth.** A journal is the match metadata plus every
  accepted authoritative mutation in order: player commands and server presence commands
  alike, each with the revision it produced, the round and phase after it, and a
  checkpoint. Events are derived from commands by `applyCommand` and are not recorded.
- **Checkpoints** are FNV-1a fingerprints of the canonical JSON (sorted keys) of the full
  state after each mutation, plus one for the initial state. Cheap at human speed, and
  they locate a divergence at the exact revision.
- **Metadata** is the match id, seed, `gameVersion`, `protocolVersion`,
  `simulationVersion`, scenario, layout source (city options or fixture name), and the
  players (id, name, specialty). Rule tables are not recorded: the build supplies them,
  and a build with different tables fails at the initial checkpoint.
- **Simulation version.** `SIMULATION_VERSION` in game-core names the deterministic
  semantics. The verifier refuses a journal recorded under another version before
  rebuilding anything; there is no backward replay compatibility, by design.
- **No secrets.** Rejoin tokens never enter the journal; player ids and names are already
  public in every snapshot.
- **Where it lives.** game-core owns the types, the fingerprint, and `replayJournal`
  (state in, verdict out). The server records entries in `ServerMatch.mutate`, exposes
  `journal()`, hands a finished journal to `JOURNAL_DIR` when configured, and owns the
  verifier that rebuilds the initial state from game-data and map-generation.

## Consequences

- A bug report needs the journal file name (`<matchId>-<seed>.json`) and nothing else.
- Any rule change that alters what a command does must bump `SIMULATION_VERSION`
  (docs/DEVELOPMENT.md, "Version bump rules"), or old journals fail with
  `CHECKPOINT_MISMATCH` instead of the clear `UNSUPPORTED_SIMULATION_VERSION`.
- Journals grow by one entry per accepted mutation; a long match is a few hundred
  kilobytes. Persistence of journals across restarts is milestone N's concern.
