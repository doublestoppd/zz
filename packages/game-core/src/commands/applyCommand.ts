import type { GameState } from "../state/types.js";
import { advanceUntilPlayerInput } from "../turn/phases.js";
import { applyFireWeapon, applyReload } from "./handlers/combat.js";
import { applyPickUp, applyUseItem } from "./handlers/items.js";
import { applyMove } from "./handlers/move.js";
import type { CommandResult } from "./handlers/result.js";
import { applyEndTurn, applySetPlayerPresence } from "./handlers/turn.js";
import type { Command } from "./types.js";

export type { CommandResult } from "./handlers/result.js";

/**
 * The single entry point for changing game state.
 *
 * Validates `command` against `state`, applies it, then drives any non-player phases so the
 * returned state is always either waiting on a player or finished. Pure: same inputs, same
 * outputs; the gameplay Rng is rebuilt from `state.rngState` when needed.
 *
 * Each command's validation and state change lives in `handlers/`; this file only routes.
 */
export function applyCommand(state: GameState, command: Command): CommandResult {
  const applied = applyOne(state, command);
  if (!applied.ok) return applied;
  const settled = advanceUntilPlayerInput(applied.state);
  return { ok: true, state: settled.state, events: [...applied.events, ...settled.events] };
}

function applyOne(state: GameState, command: Command): CommandResult {
  switch (command.type) {
    case "move":
      return applyMove(state, command);
    case "fire_weapon":
      return applyFireWeapon(state, command);
    case "reload":
      return applyReload(state, command);
    case "pick_up":
      return applyPickUp(state, command);
    case "use_item":
      return applyUseItem(state, command);
    case "end_turn":
      return applyEndTurn(state, command);
    case "set_player_presence":
      return applySetPlayerPresence(state, command);
  }
}
