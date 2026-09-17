/**
 * Client/server contracts. Every message crossing the socket is defined in messages.ts and
 * documented in docs/NETWORK-PROTOCOL.md. Encoding is plain JSON.
 */
export * from "./messages.js";
export {
  decodeClientMessage,
  isValidPlayerName,
  type DecodeResult,
} from "./decodeClientMessage.js";
export { decodeServerMessage } from "./decodeServerMessage.js";

export function encodeMessage(message: unknown): string {
  return JSON.stringify(message);
}
