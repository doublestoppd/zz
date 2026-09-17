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
};
