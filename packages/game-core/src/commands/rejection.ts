import type { MoveRejectionReason } from "../rules/movement.js";

/** Reasons that apply to any player command, checked before command-specific rules. */
export type TurnRejectionReason =
  "UNKNOWN_PLAYER" | "MATCH_FINISHED" | "WRONG_PHASE" | "NOT_YOUR_TURN";

/**
 * Every reason a command can be rejected. A closed union so the client can map each
 * to a message and the compiler flags an unhandled case.
 */
export type RejectionReason = TurnRejectionReason | MoveRejectionReason;
