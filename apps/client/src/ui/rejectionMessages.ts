import type { RejectionReason } from "@zombie/game-core";

/** Player-facing text for every rejection the server can send. The union keeps this complete. */
export const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  UNKNOWN_PLAYER: "The server does not recognise you. Try rejoining.",
  MATCH_FINISHED: "The match is over.",
  WRONG_PHASE: "You cannot act right now.",
  NOT_YOUR_TURN: "It is not your turn.",
  DESTINATION_OUT_OF_BOUNDS: "That tile is outside the map.",
  DESTINATION_BLOCKED: "You cannot walk there.",
  DESTINATION_OCCUPIED: "Someone is already standing there.",
  DESTINATION_IS_CURRENT_POSITION: "You are already there.",
  DESTINATION_UNREACHABLE: "There is no path to that tile.",
  INSUFFICIENT_ACTION_POINTS: "Not enough action points.",
  TARGET_NOT_FOUND: "That target is gone.",
  OUT_OF_RANGE: "That target is out of range.",
  NO_LINE_OF_SIGHT: "You cannot see that target.",
  WEAPON_EMPTY: "Your weapon is empty. Reload.",
  MAGAZINE_FULL: "Your weapon is already full.",
  NO_RESERVE_AMMO: "No ammunition left to reload with.",
  ITEM_NOT_FOUND: "That item is gone.",
  ITEM_NOT_HERE: "You must stand on an item to pick it up.",
  INVENTORY_FULL: "You cannot carry any more.",
  ITEM_NOT_CARRIED: "You are not carrying that.",
  HEALTH_ALREADY_FULL: "You are already at full health.",
};
