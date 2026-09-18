import type { RejectionReason } from "@zombie/game-core";
import type { CommandRejectionReason, RejectedMessage } from "@zombie/protocol";

/** Player-facing text for every rejection the server can send. The union keeps this complete. */
export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  UNKNOWN_PLAYER: "The server does not recognise you. Try rejoining.",
  MATCH_FINISHED: "The match is over.",
  WRONG_PHASE: "You cannot act right now.",
  NOT_YOUR_TURN: "It is not your turn.",
  PLAYER_NOT_ACTIVE: "You are down and cannot act.",
  DESTINATION_OUT_OF_BOUNDS: "That tile is outside the map.",
  DESTINATION_BLOCKED: "You cannot walk there.",
  DESTINATION_OCCUPIED: "Someone is already standing there.",
  DESTINATION_IS_CURRENT_POSITION: "You are already there.",
  DESTINATION_UNREACHABLE: "There is no path to that tile.",
  INSUFFICIENT_ACTION_POINTS: "Not enough action points.",
  TARGET_NOT_FOUND: "That target is gone.",
  OUT_OF_RANGE: "That target is out of range.",
  NO_LINE_OF_SIGHT: "You cannot see that target.",
  NOT_ADJACENT: "Get next to it to strike.",
  WEAPON_EMPTY: "Your weapon is empty. Reload.",
  MAGAZINE_FULL: "Your weapon is already full.",
  NO_RESERVE_AMMO: "No ammunition left to reload with.",
  ITEM_NOT_FOUND: "That item is gone.",
  ITEM_NOT_HERE: "You must stand on an item to pick it up.",
  INVENTORY_FULL: "You cannot carry any more.",
  ITEM_NOT_CARRIED: "You are not carrying that.",
  HEALTH_ALREADY_FULL: "You are already at full health.",
  CONTAINER_NOT_FOUND: "There is nothing to search there.",
  CONTAINER_OUT_OF_REACH: "Stand on or next to it to search.",
  CONTAINER_ALREADY_SEARCHED: "That has already been searched.",
  ITEM_NOT_USABLE: "That cannot be used on its own.",
  BARRIER_NOT_FOUND: "There is no door or window there.",
  BARRIER_OUT_OF_REACH: "Stand next to it first.",
  NOT_A_DOOR: "That is a window: it can only be forced.",
  DOOR_LOCKED: "Locked. Open it with a key, or force it (loud).",
  DOOR_ALREADY_OPEN: "That door is already open.",
  DOOR_ALREADY_CLOSED: "That door is already closed.",
  DOOR_BROKEN: "That door is broken and hangs open for good.",
  DOOR_OBSTRUCTED: "Someone is standing in the doorway.",
  BARRIER_NOT_FORCEABLE: "Nothing to force there; just open it.",
};

/** Player-facing text for the protocol-level categories, used when no rule detail is given. */
export const CATEGORY_MESSAGES: Readonly<Record<CommandRejectionReason, string>> = {
  MALFORMED_COMMAND: "That command could not be understood by the server.",
  NOT_AUTHORIZED: "You cannot act for that player.",
  MATCH_NOT_STARTED: "The match has not started yet.",
  DUPLICATE_COMMAND: "That command was already received.",
  STALE_REVISION: "The board changed before your command arrived; catching up.",
  INVALID_PHASE: "You cannot act right now.",
  INVALID_ACTION: "That action is not allowed.",
};

/** The most specific text available: the rule behind a rejection when the server named one. */
export function describeRejection(rejection: RejectedMessage): string {
  return rejection.detail === undefined
    ? CATEGORY_MESSAGES[rejection.reason]
    : REJECTION_MESSAGES[rejection.detail];
}
