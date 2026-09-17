import {
  legalMoveDestinations,
  positionsEqual,
  type GameState,
  type PlayerId,
  type Position,
} from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";

/**
 * Turns a tile click into a move command, or nothing when the click cannot be a legal move.
 * This mirrors the server's rule so obviously illegal clicks are not sent, but the server
 * remains the authority: a command returned here can still be rejected.
 */
export function decideMoveIntent(
  state: GameState,
  me: PlayerId,
  tile: Position,
): ClientCommand | undefined {
  if (state.phase.kind !== "player_turn" || state.phase.activePlayerId !== me) return undefined;
  const legal = legalMoveDestinations(state, me).some((p) => positionsEqual(p, tile));
  return legal ? { type: "move", to: tile } : undefined;
}
