import type { PlayerId } from "../ids.js";
import type { GameState, PlayerState } from "../state/types.js";
import type { TurnRejectionReason } from "./rejection.js";

export type ActivePlayerCheck =
  | { readonly ok: true; readonly player: PlayerState }
  | { readonly ok: false; readonly reason: TurnRejectionReason };

/**
 * The checks shared by every player command: the player exists, the match is running,
 * it is a player turn, this player is the active one, and they are still standing.
 * The last check is defence in depth: the turn machine never makes a down survivor active,
 * but a command must not be able to exploit it if that invariant ever breaks.
 */
export function requireActivePlayer(state: GameState, playerId: PlayerId): ActivePlayerCheck {
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined) return { ok: false, reason: "UNKNOWN_PLAYER" };
  if (state.phase.kind === "finished") return { ok: false, reason: "MATCH_FINISHED" };
  if (state.phase.kind !== "player_turn") return { ok: false, reason: "WRONG_PHASE" };
  if (state.phase.activePlayerId !== playerId) return { ok: false, reason: "NOT_YOUR_TURN" };
  if (player.status !== "active") return { ok: false, reason: "PLAYER_NOT_ACTIVE" };
  return { ok: true, player };
}
