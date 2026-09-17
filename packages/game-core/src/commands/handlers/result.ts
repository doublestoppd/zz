import type { GameEvent } from "../../events/types.js";
import type { GameState } from "../../state/types.js";
import type { Transition } from "../../turn/phases.js";
import type { RejectionReason } from "../rejection.js";

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: RejectionReason };

export function ok(transition: Transition): CommandResult {
  return { ok: true, state: transition.state, events: transition.events };
}
