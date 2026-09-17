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
  DUPLICATE_COMMAND: "That command was already received.",
  STALE_STATE: "The board changed before your command arrived. Try again.",
  RATE_LIMITED: "Too many messages; slow down.",
};

/** Answers the sender with a fixed, non-internal text; `seq` ties the error to a command. */
export function sendError(session: ClientSession, code: ErrorCode, seq?: number): void {
  session.send(
    seq === undefined
      ? { t: "error", code, message: ERROR_TEXT[code] }
      : { t: "error", code, message: ERROR_TEXT[code], seq },
  );
}
