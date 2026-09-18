import {
  barrierId,
  containerId,
  ITEM_TYPES,
  itemId,
  zombieId,
  type ItemType,
} from "@zombie/game-core";
import { isInteger, isPosition, isRecord, isString } from "./guards.js";
import {
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_NAME_MIN_LENGTH,
  type ClientCommand,
  type ClientMessage,
} from "./messages.js";

export type DecodeResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function fail<T>(error: string): DecodeResult<T> {
  return { ok: false, error };
}

/** Matches ASCII control characters (0x00-0x1f and 0x7f). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

/** A name the lobby will accept: trimmed, within length limits, no control characters. */
export function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= PLAYER_NAME_MIN_LENGTH &&
    trimmed.length <= PLAYER_NAME_MAX_LENGTH &&
    !CONTROL_CHARACTERS.test(trimmed)
  );
}

/**
 * Parses raw socket text into a `ClientMessage`, accepting only exactly the shapes the
 * protocol defines. Anything else, including unknown command types and non-integer
 * coordinates, is rejected with a human-readable reason. Never throws.
 */
export function decodeClientMessage(raw: string): DecodeResult<ClientMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("not valid JSON");
  }
  if (!isRecord(parsed)) return fail("message must be an object");

  switch (parsed.t) {
    case "create_match":
      if (!isString(parsed.playerName)) return fail("create_match.playerName must be a string");
      return { ok: true, value: { t: "create_match", playerName: parsed.playerName } };

    case "join_match":
      if (!isString(parsed.matchCode)) return fail("join_match.matchCode must be a string");
      if (!isString(parsed.playerName)) return fail("join_match.playerName must be a string");
      return {
        ok: true,
        value: { t: "join_match", matchCode: parsed.matchCode, playerName: parsed.playerName },
      };

    case "rejoin_match":
      if (!isString(parsed.matchCode)) return fail("rejoin_match.matchCode must be a string");
      if (!isString(parsed.rejoinToken)) return fail("rejoin_match.rejoinToken must be a string");
      return {
        ok: true,
        value: { t: "rejoin_match", matchCode: parsed.matchCode, rejoinToken: parsed.rejoinToken },
      };

    case "start_match":
      return { ok: true, value: { t: "start_match" } };

    case "leave_match":
      return { ok: true, value: { t: "leave_match" } };

    case "command": {
      if (!isInteger(parsed.seq)) return fail("command.seq must be an integer");
      if (!isInteger(parsed.expectedVersion)) {
        return fail("command.expectedVersion must be an integer");
      }
      const command = decodeClientCommand(parsed.command);
      if (!command.ok) return fail(command.error);
      return {
        ok: true,
        value: {
          t: "command",
          seq: parsed.seq,
          expectedVersion: parsed.expectedVersion,
          command: command.value,
        },
      };
    }

    default:
      return fail("unknown message type");
  }
}

function isItemType(value: unknown): value is ItemType {
  return isString(value) && (ITEM_TYPES as readonly string[]).includes(value);
}

function decodeClientCommand(value: unknown): DecodeResult<ClientCommand> {
  if (!isRecord(value)) return fail("command.command must be an object");
  switch (value.type) {
    case "move":
      if (!isPosition(value.to)) return fail("move.to must be integer {x, y}");
      return { ok: true, value: { type: "move", to: { x: value.to.x, y: value.to.y } } };
    case "fire_weapon":
      if (!isString(value.targetId)) return fail("fire_weapon.targetId must be a string");
      return { ok: true, value: { type: "fire_weapon", targetId: zombieId(value.targetId) } };
    case "reload":
      return { ok: true, value: { type: "reload" } };
    case "pick_up":
      if (!isString(value.itemId)) return fail("pick_up.itemId must be a string");
      return { ok: true, value: { type: "pick_up", itemId: itemId(value.itemId) } };
    case "use_item":
      if (!isItemType(value.itemType)) return fail("use_item.itemType must be a known item type");
      return { ok: true, value: { type: "use_item", itemType: value.itemType } };
    case "search":
      if (!isString(value.containerId)) return fail("search.containerId must be a string");
      return { ok: true, value: { type: "search", containerId: containerId(value.containerId) } };
    case "open_door":
    case "close_door":
    case "force_entry":
      if (!isString(value.barrierId)) return fail(`${value.type}.barrierId must be a string`);
      return { ok: true, value: { type: value.type, barrierId: barrierId(value.barrierId) } };
    case "end_turn":
      return { ok: true, value: { type: "end_turn" } };
    default:
      return fail("unknown command type");
  }
}
