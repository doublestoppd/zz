import { validateMove } from "../../rules/movement.js";
import { replacePlayer } from "../../state/players.js";
import type { GameState } from "../../state/types.js";
import { requireActivePlayer } from "../turnChecks.js";
import type { MoveCommand } from "../types.js";
import { ok, type CommandResult } from "./result.js";

export function applyMove(state: GameState, command: MoveCommand): CommandResult {
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
