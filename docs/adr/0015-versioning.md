# ADR 0015: Three versions and a refusing handshake

## Status

Accepted (engineering milestone T).

## Context

A browser tab can stay open across a deploy. After one, the loaded client may speak an
older protocol, and a journal written earlier may have been produced by older rules. The
server needs to tell both apart from a bug, and the player needs one clear instruction.

## Decision

- **Three independent versions.** `protocolVersion` (message contracts), `simulationVersion`
  (deterministic rule semantics), `gameVersion` (the release label). Each changes for its
  own reason and none implies another; the bump rules live in DEVELOPMENT.md.
- **A handshake, first thing on every socket.** `hello {protocolVersion, gameVersion}`;
  the server answers `welcome` with its own three versions or `error VERSION_MISMATCH` and
  closes with 1008. Anything else before `hello` gets the same refusal, which is how a
  client loaded before the handshake existed learns to refresh without a special case.
- **Equality, not ranges.** Compatibility is `protocolVersion` equality. Supporting
  several historical client versions side by side would mean keeping old decoders and
  message shapes alive for tabs that a refresh fixes; there is no concrete need.
- **The client stops.** On `VERSION_MISMATCH` the client stops reconnecting (reconnecting
  would loop) and shows "The game has been updated. Refresh to continue." in the status
  line. Nothing else changes: a player mid-match refreshes and rejoins with the stored
  token.
- **Journals carry all three.** Already the case; the replay verifier refuses another
  `simulationVersion` before rebuilding any state, so an old journal is never "almost
  right".

## Consequences

- Every deploy that bumps the protocol disconnects loaded clients once; the server logs
  `version mismatch` at info and counts them, so a burst right after a deploy is expected
  and a trickle later is a stale tab.
- `PROTOCOL_VERSION` is 5 (hello, welcome, VERSION_MISMATCH).
- `gameVersion` is informational on both sides; a client that lies about it gains
  nothing, and it is length-capped like every other client string.
