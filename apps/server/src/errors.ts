import type { ErrorCode } from "@zombie/protocol";
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
  RATE_LIMITED: "Too many messages; slow down.",
  SESSION_REPLACED: "Another connection took over this player.",
  SHUTTING_DOWN: "The server is restarting; try again in a moment.",
  INTERNAL_ERROR: "The server hit a problem handling that message.",
};

/** Answers the sender with a fixed, non-internal text. Never includes exception details. */
export function sendError(session: ClientSession, code: ErrorCode): void {
  session.send({ t: "error", code, message: ERROR_TEXT[code] });
}
