import type { DecodeResult } from "./decodeClientMessage.js";
import { isRecord } from "./guards.js";
import type { ServerMessage } from "./messages.js";

const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set<ServerMessage["t"]>([
  "joined",
  "lobby",
  "map",
  "update",
  "rejected",
  "error",
]);

/**
 * Parses raw socket text from the server. The client trusts the server, so this checks
 * only that the payload is an object with a known `t`; it does not re-validate every
 * field of a GameState snapshot. Never throws.
 */
export function decodeServerMessage(raw: string): DecodeResult<ServerMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!isRecord(parsed) || typeof parsed.t !== "string" || !SERVER_MESSAGE_TYPES.has(parsed.t)) {
    return { ok: false, error: "unknown server message" };
  }
  return { ok: true, value: parsed as unknown as ServerMessage };
}
