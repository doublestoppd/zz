# ADR 0014: Abuse resistance at the network boundary

## Status

Accepted (engineering milestone S).

## Context

The server is public: anyone who can reach the port can open sockets and send bytes.
Authoritative validation already makes cheating pointless, but a hostile or broken client
could still exhaust connections, enumerate lobby codes, hold rooms, or find a crash in the
HTTP side. The threat surface is small and specific; the countermeasures should be too.

## Decision

- **Refuse at the cheapest point.** Origin, total connections, and per-address connections
  are checked at the HTTP upgrade, so a refused client costs one response and never
  allocates a socket or a session. Payload size, message rate, and shape are checked by
  the socket layer and the decoders before any handler runs.
- **Every client string is bounded and rebuilt.** The decoders cap identifiers, codes,
  tokens, and names and construct fresh objects, so nothing a client sends reaches the
  state, the journal, or a record by accident.
- **Throttle failed lookups per address, not joins.** A wrong code or token counts; a
  correct one does not. Ten failures a minute make enumerating four-character codes
  impractical without punishing a player who mistyped once.
- **Room capacity is a configured number, not memory pressure.** `MAX_MATCHES` keeps one
  process fair; a full server says so (`SERVER_FULL`) instead of degrading.
- **Behind a proxy, the address comes from `X-Forwarded-For` only when `TRUST_PROXY` is
  set.** Otherwise a client could claim any address and dodge the per-address limits.
- **Constant-time admin token comparison and security headers**, because they cost
  nothing. A script content security policy is left to the deployment: the client is one
  bundle with no inline scripts, so a strict policy can be added at the proxy.
- **Not done, on purpose:** accounts, signed messages, TLS in the process, IP reputation,
  captchas. None addresses a threat this game has today.

## Consequences

- `PROTOCOL_VERSION` is 4: `SERVER_FULL` joined the error codes and the identifier caps
  are part of the contract.
- Production must set `ALLOWED_ORIGINS`; the default (any origin) exists for development
  and is logged at startup as `"any"`.
- The per-address limits are keyed by IP address; players sharing a NAT share the
  16-socket allowance, which is enough for a table of friends and a spectator.
