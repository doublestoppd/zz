# Security and abuse resistance

What the public surface trusts, what it checks, and where. The game has no accounts, no
payments, and no private data beyond a chosen display name: the assets are the server's
availability and the fairness of a match. Cheating is prevented by authoritative
validation, not secrecy ([ADR 0001](adr/0001-server-authoritative-simulation.md)); this
document is about abuse of the network surface ([ADR 0014](adr/0014-abuse-resistance.md)).

## Trust boundaries

```
browser --HTTP upgrade--> socket layer --decoded ClientMessage--> router --> lobby / match --> game-core
         (origin, counts)  (size, rate, shape)                   (state)    (ownership, limits) (rules)
```

- **Untrusted:** every byte a client sends, the `Origin` header, the `X-Forwarded-For`
  header unless `TRUST_PROXY` is set, and URL paths.
- **Trusted:** environment variables, the built client bundle in `STATIC_DIR`, records in
  `STATE_DIR` (written only by this server; they hold rejoin tokens, so the directory is
  private), and the game-core rule tables.
- **Secrets:** rejoin tokens (`randomUUID`, 122 random bits from the platform's CSPRNG)
  and the admin token. Tokens travel only in the `joined` message to their owner and in
  `STATE_DIR` records; they never appear in logs, journals, diagnostics, or the redacted
  state. The simulation's seeded RNG is a separate thing and is never used for either.
  Match codes are not secrets: they let a stranger join an open lobby, nothing more.

## What is checked where

| Boundary     | Check                                                                                                                                   | Answer                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| HTTP upgrade | `Origin` in `ALLOWED_ORIGINS` (browsers always send it; non-browser clients may omit it)                                                | 403, no socket                                      |
| HTTP upgrade | `MAX_CONNECTIONS` in total, `MAX_CONNECTIONS_PER_ADDRESS` per client address                                                            | 503 / 429, no socket                                |
| socket       | text frames at most 16 KB; binary frames are malformed                                                                                  | close 1009 / `MALFORMED_MESSAGE`                    |
| socket       | 20-message burst then 10 per second per socket; a client that keeps flooding is closed                                                  | `RATE_LIMITED`, then close 1008                     |
| socket       | liveness ping every 30 s                                                                                                                | terminate                                           |
| decoder      | exact message shapes, known `t` and command types, integer coordinates, bounded strings, closed enums for specialty, scenario, item     | `MALFORMED_MESSAGE` / `rejected MALFORMED_COMMAND`  |
| router       | message allowed in the session's state (not in a match, already in one, draining)                                                       | `NOT_IN_MATCH`, `ALREADY_IN_MATCH`, `SHUTTING_DOWN` |
| lobby        | `MAX_MATCHES` rooms; ten failed lookups per address per minute                                                                          | `SERVER_FULL` / `RATE_LIMITED`                      |
| match        | sender is a member; host-only actions; `playerId` stamped from the session, never read from the payload; duplicate ids; stale revisions | `NOT_HOST`, `rejected NOT_AUTHORIZED`, and so on    |
| game-core    | every rule: turn, phase, action points, range, line of sight; items, targets, doors, and containers looked up by id in the state        | `rejected INVALID_ACTION` with the reason           |
| runtime      | the resulting state passes the invariant check                                                                                          | `INTERNAL_ERROR`, state unchanged                   |
| HTTP static  | path decoded safely, normalised, and kept under `STATIC_DIR`; security headers on every response                                        | 400 / 403 / 404                                     |
| HTTP admin   | bearer token compared in constant time; endpoints invisible (404) unless configured                                                     | 404                                                 |

Client-supplied strings are never used as keys on server-owned objects: enums are checked
against closed lists before indexing rule tables, ids are looked up in arrays, and decoded
messages are built field by field, so unknown fields never ride into the state, the
journal, or a persistence record.

## What a client can and cannot do

- **Cannot** move another survivor, act out of turn, spend more than its action points,
  shoot through walls, take loot it does not stand on, or see zombies out of the team's
  sight (the server redacts them before sending). All of this is validation in game-core
  and the match, exercised by the integration tests and the soak.
- **Can** see the whole team's view, including teammates' positions and inventories,
  because the game is cooperative and the team shares one view by design.
- **Can** join any open lobby whose code it knows and occupy a slot. The host cannot kick
  yet; the lookup throttle makes guessing codes slow (ten failures per address per minute
  against 32^4 codes) and the room limit bounds the damage.
- **Can** open up to 16 sockets per address and hold one lobby per socket; both are
  configurable and an empty lobby is dropped the moment its last socket closes.

## Failure and disclosure

Clients receive fixed texts per error code and machine-readable rejection reasons, never
an exception message, a stack, or a path. Handler exceptions and invariant violations are
logged server-side with correlation ids. A malformed URL is a 400, not a crash. The process
exits on an uncaught exception (a corrupt process is worse than a restart) and restart
recovery covers the matches.

## Deliberately out of scope

Accounts and authentication, transport encryption (terminate TLS at the reverse proxy),
DDoS absorption beyond the counts above (that is the host's edge), anti-cheat beyond
authoritative validation (there is nothing to hide from a cooperative team), and
per-message signatures. Revisit when the game has persistent identity or competition.
