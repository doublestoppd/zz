import type { GameEvent } from "../../events/types.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState } from "../../state/types.js";
import { endActiveTurn, reassignTurnIfActivePlayerIneligible } from "../../turn/phases.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { EndTurnCommand, SetPlayerPresenceCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

export function applyEndTurn(state: GameState, command: EndTurnCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  return ok(endActiveTurn(state));
}

/**
 * Presence changes are always accepted for known players (an unknown id is a server bug,
 * reported as a no-op rather than thrown so the server keeps running). A change that
 * leaves the active player unable to act hands the turn on.
 */
export function applySetPlayerPresence(
  state: GameState,
  command: SetPlayerPresenceCommand,
): CommandResult {
  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined || player.present === command.present) {
    return ok({ state, events: [] });
  }
  const updated = replacePlayer(state, { ...player, present: command.present });
  const changed: GameEvent = {
    type: "player_presence_changed",
    playerId: command.playerId,
    present: command.present,
  };
  const reassigned = reassignTurnIfActivePlayerIneligible(updated);
  return ok({ state: reassigned.state, events: [changed, ...reassigned.events] });
}
