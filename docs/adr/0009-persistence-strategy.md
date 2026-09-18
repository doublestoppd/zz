# ADR 0009: Persistence strategy

## Status

Accepted (engineering milestone N).

## Context

A process restart (deploy, crash) must not destroy active matches, and the state that
survives must be exactly the authoritative state, at its revision, with the journal intact.
Expected scale is a handful of concurrent matches on one process.

## Decision

- **What is persisted.** One record per match: its lifecycle status, host, members (id,
  name, specialty, rejoin token) and the journal. The state itself is not stored: it is
  rebuilt by replaying the journal, which is already the source of truth (ADR 0008). The
  revision after restore equals the number of journal entries.
- **When.** After every accepted mutation, and at start. A record is a few hundred
  kilobytes at most and matches move at human speed, so a whole-file write per mutation
  is simpler and safer than batching. Lobbies are not persisted: nothing in a lobby is
  worth recovering.
- **Where.** `MatchStore`, one small interface (`save`, `delete`, `list`) with two
  implementations: `FileMatchStore` (one JSON file per match under `STATE_DIR`, written
  to a temp file and renamed so a crash never leaves a torn record) and
  `MemoryMatchStore` (tests, and the default when no directory is configured). There is
  no database and no repository layer.
- **Recovery.** On startup the registry restores every `active` record by rebuilding the
  initial state from the journal metadata and re-applying every entry; the journal is
  verified first, and a record that does not replay is logged with its reason and
  removed rather than served. Restored members start absent (recorded as presence
  mutations) and return through the ordinary rejoin path; the abandonment grace period
  starts immediately.
- **Retention.** `completed` records are kept 24 hours (`COMPLETED_RETENTION_MS`) for
  bug reports and swept on startup; `abandoned` matches (nobody back within the 10-minute
  grace) delete their record; lobbies never had one.
- **Shutdown.** On SIGINT/SIGTERM the registry drains: no lobby may be created or joined
  (`SHUTTING_DOWN`), every connected player is told and closed with 1001 so the client
  reconnects and rejoins the restored match, then the listener closes.

## Consequences

- The state directory holds rejoin tokens and must be private to the server.
- Restore time is proportional to journal length (a full replay); at this scale that is
  milliseconds per match.
- A simulation version bump makes old active records unrestorable by design; they are
  discarded with a clear log line rather than replayed into a different game.
