# ADR 0007: Session identity and reconnect policy

## Status

Accepted (engineering milestone L).

## Context

A browser tab is not a player. Tabs reload, laptops sleep, and mobile networks drop; a
turn-based cooperative match must survive all of that without duplicating a survivor,
resetting their inventory, or letting two tabs act for one person.

## Decision

- **Identity.** A player is a `Member` of a `ServerMatch`: a `playerId` (public, printed in
  every snapshot) plus a `rejoinToken` (secret, a `crypto.randomUUID()`, sent once in
  `joined` and otherwise only ever compared). The socket is a transient attachment to the
  member. Command ids are remembered per member, not per socket.
- **Refresh is a reconnect.** The browser client stores the token in `sessionStorage` and
  sends `rejoin_match` whenever a socket opens while it remembers a slot. The server reattaches
  the new socket to the same member and sends `map` plus a full snapshot with the current
  revision; the client discards everything it showed before and rebuilds from that snapshot.
- **Duplicate session.** The newest socket wins: the older one is told `SESSION_REPLACED`
  and closed (1008). Two sockets never hold one member at the same time, so two tabs cannot
  both issue commands for one identity.
- **Active player disconnects.** The turn passes immediately (`set_player_presence` is an
  authoritative mutation that bumps the revision; `reassignTurnIfActivePlayerIneligible`
  hands the turn on). An absent player is skipped in turn order and gets their next turn
  when they are back and their turn comes round again. No timers touch game state.
- **Zombie and end-of-round phases.** The server resolves them synchronously inside the
  command that ends the last turn, so a socket can never be "between" phases; a reconnect
  always lands in a player turn or a finished match.
- **Per-player grace.** Unlimited within the match: an absent survivor's body stays on the
  board, can be attacked and downed, and never blocks the others, so there is nothing to
  forfeit. Their slot is theirs until the match ends or is deleted.
- **Whole-party grace.** A started match with no connected members is kept for 10 minutes
  (`ABANDONED_MATCH_TTL_MS`) and then deleted; a lobby with nobody in it is deleted at once.
- **Finished matches.** A rejoin still answers with the final snapshot; gameplay commands
  are refused as `INVALID_PHASE` / `MATCH_FINISHED`.

## Consequences

- The reconnect token is the only credential and must never appear in logs, replays, or
  client-visible match state; structured logs carry `playerId` only.
- Because presence is an authoritative mutation, every disconnect and reconnect is visible
  in the revision sequence and the event log (`player_presence_changed`), which keeps
  replays exact.
- Per-player AI takeover or forfeit is deliberately not implemented; a skipped player is
  cheap for everyone else. Revisit if playtests show absent players stalling objectives.
