import {
  barrierId,
  containerId,
  ITEM_TYPES,
  itemId,
  SCENARIO_TYPES,
  SPECIALTY_TYPES,
  zombieId,
  type ItemType,
  type ScenarioType,
  type SpecialtyType,
} from "@zombie/game-core";
import { isInteger, isPosition, isRecord, isString } from "./guards.js";
import {
  GAME_VERSION_MAX_LENGTH,
  ID_MAX_LENGTH,
  isValidCommandId,
  MATCH_CODE_MAX_LENGTH,
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_NAME_MIN_LENGTH,
  PLAYER_NAME_RAW_MAX_LENGTH,
  REJOIN_TOKEN_MAX_LENGTH,
  type ClientCommand,
  type ClientMessage,
} from "./messages.js";

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: string;
      /** Set when a `command` envelope was well-formed but its body was not, so the sender can be answered per command. */
      readonly commandId?: string;
    };

function fail<T>(error: string, commandId?: string): DecodeResult<T> {
  return commandId === undefined ? { ok: false, error } : { ok: false, error, commandId };
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

/** A string within a length cap: every client-supplied identifier goes through this. */
function isBoundedString(value: unknown, max: number): value is string {
  return isString(value) && value.length >= 1 && value.length <= max;
}
const isId = (value: unknown): value is string => isBoundedString(value, ID_MAX_LENGTH);

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
    case "hello": {
      if (!isInteger(parsed.protocolVersion) || parsed.protocolVersion < 0) {
        return fail("hello.protocolVersion must be a non-negative integer");
      }
      if (!isBoundedString(parsed.gameVersion, GAME_VERSION_MAX_LENGTH)) {
        return fail("hello.gameVersion must be a string of at most 64 characters");
      }
      return {
        ok: true,
        value: {
          t: "hello",
          protocolVersion: parsed.protocolVersion,
          gameVersion: parsed.gameVersion,
        },
      };
    }
    case "create_match": {
      if (!isBoundedString(parsed.playerName, PLAYER_NAME_RAW_MAX_LENGTH)) {
        return fail("create_match.playerName must be a string of at most 200 characters");
      }
      const specialty = decodeSpecialty(parsed.specialty);
      if (!specialty.ok) return fail(specialty.error);
      return {
        ok: true,
        value: { t: "create_match", playerName: parsed.playerName, specialty: specialty.value },
      };
    }

    case "join_match": {
      if (!isBoundedString(parsed.matchCode, MATCH_CODE_MAX_LENGTH)) {
        return fail("join_match.matchCode must be a string of at most 16 characters");
      }
      if (!isBoundedString(parsed.playerName, PLAYER_NAME_RAW_MAX_LENGTH)) {
        return fail("join_match.playerName must be a string of at most 200 characters");
      }
      const specialty = decodeSpecialty(parsed.specialty);
      if (!specialty.ok) return fail(specialty.error);
      return {
        ok: true,
        value: {
          t: "join_match",
          matchCode: parsed.matchCode,
          playerName: parsed.playerName,
          specialty: specialty.value,
        },
      };
    }

    case "set_specialty": {
      if (parsed.specialty === undefined) return fail("set_specialty.specialty is required");
      const specialty = decodeSpecialty(parsed.specialty);
      if (!specialty.ok) return fail(specialty.error);
      return { ok: true, value: { t: "set_specialty", specialty: specialty.value } };
    }

    case "rejoin_match":
      if (!isBoundedString(parsed.matchCode, MATCH_CODE_MAX_LENGTH)) {
        return fail("rejoin_match.matchCode must be a string of at most 16 characters");
      }
      if (!isBoundedString(parsed.rejoinToken, REJOIN_TOKEN_MAX_LENGTH)) {
        return fail("rejoin_match.rejoinToken must be a string of at most 128 characters");
      }
      return {
        ok: true,
        value: { t: "rejoin_match", matchCode: parsed.matchCode, rejoinToken: parsed.rejoinToken },
      };

    case "start_match": {
      if (parsed.scenario === undefined) return { ok: true, value: { t: "start_match" } };
      if (
        !isString(parsed.scenario) ||
        !(SCENARIO_TYPES as readonly string[]).includes(parsed.scenario)
      ) {
        return fail("start_match.scenario must be one of " + SCENARIO_TYPES.join(", "));
      }
      return { ok: true, value: { t: "start_match", scenario: parsed.scenario as ScenarioType } };
    }

    case "leave_match":
      return { ok: true, value: { t: "leave_match" } };

    case "command": {
      if (!isValidCommandId(parsed.commandId)) {
        return fail("command.commandId must be 1-64 characters of [A-Za-z0-9_-]");
      }
      if (!isInteger(parsed.baseRevision) || parsed.baseRevision < 0) {
        return fail("command.baseRevision must be a non-negative integer", parsed.commandId);
      }
      const command = decodeClientCommand(parsed.command);
      if (!command.ok) return fail(command.error, parsed.commandId);
      return {
        ok: true,
        value: {
          t: "command",
          commandId: parsed.commandId,
          baseRevision: parsed.baseRevision,
          command: command.value,
        },
      };
    }

    case "resync":
      return { ok: true, value: { t: "resync" } };

    default:
      return fail("unknown message type");
  }
}

/** An absent specialty means the plain survivor; anything present must be a known one. */
function decodeSpecialty(value: unknown): DecodeResult<SpecialtyType> {
  if (value === undefined) return { ok: true, value: "survivor" };
  if (isString(value) && (SPECIALTY_TYPES as readonly string[]).includes(value)) {
    return { ok: true, value: value as SpecialtyType };
  }
  return fail("specialty must be one of " + SPECIALTY_TYPES.join(", "));
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
    case "melee_attack":
      if (!isId(value.targetId)) return fail(`${value.type}.targetId must be an id`);
      return { ok: true, value: { type: value.type, targetId: zombieId(value.targetId) } };
    case "reload":
      return { ok: true, value: { type: "reload" } };
    case "pick_up":
      if (!isId(value.itemId)) return fail("pick_up.itemId must be an id");
      return { ok: true, value: { type: "pick_up", itemId: itemId(value.itemId) } };
    case "use_item":
      if (!isItemType(value.itemType)) return fail("use_item.itemType must be a known item type");
      return { ok: true, value: { type: "use_item", itemType: value.itemType } };
    case "search":
      if (!isId(value.containerId)) return fail("search.containerId must be an id");
      return { ok: true, value: { type: "search", containerId: containerId(value.containerId) } };
    case "open_door":
    case "close_door":
    case "force_entry":
      if (!isId(value.barrierId)) return fail(`${value.type}.barrierId must be an id`);
      return { ok: true, value: { type: value.type, barrierId: barrierId(value.barrierId) } };
    case "end_turn":
      return { ok: true, value: { type: "end_turn" } };
    default:
      return fail("unknown command type");
  }
}
