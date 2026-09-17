import type { ClientMessage, ErrorCode } from "@zombie/protocol";
import type { MatchRegistry } from "./lobby/MatchRegistry.js";
import type { ServerMatch } from "./match/ServerMatch.js";
import type { ClientSession } from "./session/ClientSession.js";

const ERROR_TEXT: Readonly<Record<ErrorCode, string>> = {
  MALFORMED_MESSAGE: "The message could not be understood.",
  INVALID_PLAYER_NAME: "Player names must be 1-20 printable characters.",
  MATCH_NOT_FOUND: "No match with that code.",
  MATCH_FULL: "That match is full.",
  MATCH_ALREADY_STARTED: "That match has already started.",
  MATCH_NOT_STARTED: "The match has not started yet.",
  NOT_IN_MATCH: "You are not in a match.",
  ALREADY_IN_MATCH: "You are already in a match.",
  NOT_HOST: "Only the host can do that.",
  INVALID_REJOIN_TOKEN: "That rejoin token is not valid for this match.",
};

export function sendError(session: ClientSession, code: ErrorCode): void {
  session.send({ t: "error", code, message: ERROR_TEXT[code] });
}

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
    case "create_match": {
      if (session.matchCode !== undefined) {
        sendError(session, "ALREADY_IN_MATCH");
        return;
      }
      const match = registry.create();
      const error = match.join(session, message.playerName);
      registry.noteMembershipChanged(match);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "join_match": {
      const match = registry.get(message.matchCode);
      if (match === undefined) {
        sendError(session, "MATCH_NOT_FOUND");
        return;
      }
      const error = match.join(session, message.playerName);
      registry.noteMembershipChanged(match);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "rejoin_match": {
      const match = registry.get(message.matchCode);
      if (match === undefined) {
        sendError(session, "MATCH_NOT_FOUND");
        return;
      }
      const error = match.rejoin(session, message.rejoinToken);
      registry.noteMembershipChanged(match);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "start_match": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.start(session);
      if (error !== undefined) sendError(session, error);
      return;
    }
    case "command": {
      const match = currentMatch(registry, session);
      if (match === undefined) {
        sendError(session, "NOT_IN_MATCH");
        return;
      }
      const error = match.handleCommand(session, message.seq, message.command);
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
