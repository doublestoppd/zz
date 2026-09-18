import type { ClientMessage } from "@zombie/protocol";
import { sendError } from "./errors.js";
import type { MatchRegistry } from "./lobby/MatchRegistry.js";
import type { ServerMatch } from "./match/ServerMatch.js";
import type { ClientSession } from "./session/ClientSession.js";

/**
 * Routes one decoded client message to the lobby or match that owns it.
 * Errors are answered to the sender; nothing here inspects game rules.
 */
export function handleClientMessage(
  registry: MatchRegistry,
  session: ClientSession,
  message: ClientMessage,
): void {
  switch (message.t) {
    case "hello":
      // Answered by the socket layer before any message reaches the router.
      return;
    case "create_match": {
      if (session.matchCode !== undefined) {
        sendError(session, "ALREADY_IN_MATCH");
        return;
      }
      const match = registry.create();
      if (typeof match === "string") {
        sendError(session, match);
        return;
      }
      const error = match.join(session, message.playerName, message.specialty);
      registry.noteMembershipChanged(match);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "join_match": {
      if (registry.isDraining()) {
        sendError(session, "SHUTTING_DOWN");
        return;
      }
      if (!registry.allowLookup(session.address)) {
        sendError(session, "RATE_LIMITED");
        return;
      }
      const match = registry.get(message.matchCode);
      if (match === undefined) {
        registry.noteLookupFailure(session.address);
        sendError(session, "MATCH_NOT_FOUND");
        return;
      }
      const error = match.join(session, message.playerName, message.specialty);
      registry.noteMembershipChanged(match);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "rejoin_match": {
      if (!registry.allowLookup(session.address)) {
        sendError(session, "RATE_LIMITED");
        return;
      }
      const match = registry.get(message.matchCode);
      if (match === undefined) {
        registry.noteLookupFailure(session.address);
        sendError(session, "MATCH_NOT_FOUND");
        return;
      }
      const error = match.rejoin(session, message.rejoinToken);
      registry.noteMembershipChanged(match);
      if (error === "INVALID_REJOIN_TOKEN") registry.noteLookupFailure(session.address);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "set_specialty": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.setSpecialty(session, message.specialty);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "start_match": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.start(session, message.scenario);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "command": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.handleCommand(session, message);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "resync": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.resync(session);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "leave_match": {
      handleDisconnect(registry, session);
      return;
    }
  }
}

export function handleDisconnect(registry: MatchRegistry, session: ClientSession): void {
  const match = currentMatch(registry, session);
  if (match === undefined) return;
  match.handleDisconnect(session);
  registry.noteMembershipChanged(match);
}

function currentMatch(registry: MatchRegistry, session: ClientSession): ServerMatch | undefined {
  return session.matchCode === undefined ? undefined : registry.get(session.matchCode);
}
