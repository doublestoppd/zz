import type { GameEvent } from "../events/types.js";
import { validateMove } from "../rules/movement.js";
import { replacePlayer } from "../state/players.js";
import type { GameState } from "../state/types.js";
import {
  advanceUntilPlayerInput,
  endActiveTurn,
  reassignTurnIfActivePlayerAbsent,
  type Transition,
} from "../turn/phases.js";
import type { RejectionReason } from "./rejection.js";
import { requireActivePlayer } from "./turnChecks.js";
import type { Command, EndTurnCommand, MoveCommand, SetPlayerPresenceCommand } from "./types.js";

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly reason: RejectionReason };

/**
 * The single entry point for changing game state.
 *
 * Validates `command` against `state`, applies it, then drives any non-player phases so the
 * returned state is always either waiting on a player or finished. Pure: same inputs, same
 * outputs; the gameplay Rng is rebuilt from `state.rngState` when needed.
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
    case "end_turn":
      return applyEndTurn(state, command);
    case "set_player_presence":
      return ok(applySetPlayerPresence(state, command));
  }
}

function ok(transition: Transition): CommandResult {
  return { ok: true, state: transition.state, events: transition.events };
}

function applyMove(state: GameState, command: MoveCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  const move = validateMove(state, check.player, command.to);
  if (!move.ok) return move;

  const moved = replacePlayer(state, {
    ...check.player,
    position: command.to,
    actionPoints: check.player.actionPoints - move.cost,
  });
  return ok({
    state: moved,
    events: [
      {
        type: "player_moved",
        playerId: command.playerId,
        path: move.path,
        actionPointsSpent: move.cost,
      },
    ],
  });
}

function applyEndTurn(state: GameState, command: EndTurnCommand): CommandResult {
  const check = requireActivePlayer(state, command.playerId);
  if (!check.ok) return check;
  return ok(endActiveTurn(state));
}

/**
 * Presence changes are always accepted for known players (an unknown id is a server bug,
 * reported as a rejection rather than thrown so the server keeps running). A change that
 * leaves the active player absent hands the turn on.
 */
function applySetPlayerPresence(state: GameState, command: SetPlayerPresenceCommand): Transition {
  const player = state.players.find((p) => p.id === command.playerId);
  if (player === undefined || player.present === command.present) {
    return { state, events: [] };
  }
  const updated = replacePlayer(state, { ...player, present: command.present });
  const changed: GameEvent = {
    type: "player_presence_changed",
    playerId: command.playerId,
    present: command.present,
  };
  const reassigned = reassignTurnIfActivePlayerAbsent(updated);
  return { state: reassigned.state, events: [changed, ...reassigned.events] };
}
