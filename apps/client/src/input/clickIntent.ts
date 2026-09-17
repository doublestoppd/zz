import {
  legalFireTargets,
  positionsEqual,
  type GameState,
  type PlayerId,
  type Position,
} from "@zombie/game-core";
import type { ClientCommand } from "@zombie/protocol";
import { decideMoveIntent } from "./moveIntent.js";

/**
 * Turns a tile click into the one command it can mean: fire at the zombie standing there
 * if that shot is legal, otherwise move there if that move is legal, otherwise nothing.
 * The server remains the authority; a command returned here can still be rejected.
 */
export function decideClickIntent(
  state: GameState,
  me: PlayerId,
  tile: Position,
): ClientCommand | undefined {
  if (state.phase.kind !== "player_turn" || state.phase.activePlayerId !== me) return undefined;
  const player = state.players.find((p) => p.id === me);
  if (player === undefined) return undefined;
  const target = legalFireTargets(state, player).find((z) => positionsEqual(z.position, tile));
  if (target !== undefined) return { type: "fire_weapon", targetId: target.id };
  return decideMoveIntent(state, me, tile);
}
