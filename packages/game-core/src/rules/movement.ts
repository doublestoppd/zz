import type { PlayerId } from "../ids.js";
import { isInBounds, positionsEqual, tileAt } from "../map/position.js";
import type { Position } from "../map/types.js";
import { findShortestPath, reachablePositions } from "../pathfinding/bfs.js";
import type { GameState, PlayerState } from "../state/types.js";
import { isBlockedByBarrier } from "../state/barriers.js";
import { canStandOn, passabilityFor } from "./occupancy.js";

export type MoveRejectionReason =
  | "DESTINATION_OUT_OF_BOUNDS"
  | "DESTINATION_BLOCKED"
  | "DESTINATION_OCCUPIED"
  | "DESTINATION_IS_CURRENT_POSITION"
  | "DESTINATION_UNREACHABLE"
  | "INSUFFICIENT_ACTION_POINTS";

export type MoveValidation =
  | { readonly ok: true; readonly path: readonly Position[]; readonly cost: number }
  | { readonly ok: false; readonly reason: MoveRejectionReason };

/** How many tiles a player can afford to step with their current action points. */
export function affordableSteps(state: GameState, player: PlayerState): number {
  return Math.floor(player.actionPoints / state.rules.moveCostPerTile);
}

/**
 * Decides whether `player` may move to `destination` and, if so, along which path and at
 * what cost. Turn/phase checks are the caller's job (commands/turnChecks.ts); this function
 * only knows about the board.
 *
 * Reasons are reported in this order: bounds, terrain, occupancy, reachability, action points.
 */
export function validateMove(
  state: GameState,
  player: PlayerState,
  destination: Position,
): MoveValidation {
  if (!isInBounds(state.map, destination)) {
    return { ok: false, reason: "DESTINATION_OUT_OF_BOUNDS" };
  }
  if (
    !(tileAt(state.map, destination)?.walkable ?? false) ||
    isBlockedByBarrier(state, destination)
  ) {
    return { ok: false, reason: "DESTINATION_BLOCKED" };
  }
  if (positionsEqual(player.position, destination)) {
    return { ok: false, reason: "DESTINATION_IS_CURRENT_POSITION" };
  }
  const mover = { kind: "survivor", id: player.id } as const;
  if (!canStandOn(state, destination, mover)) {
    return { ok: false, reason: "DESTINATION_OCCUPIED" };
  }

  const isPassable = passabilityFor(state, mover);
  // Search the whole board first so "unreachable" and "too expensive" are distinct answers.
  const unlimited = state.map.width * state.map.height;
  const path = findShortestPath(state.map, player.position, destination, unlimited, isPassable);
  if (path === undefined) {
    return { ok: false, reason: "DESTINATION_UNREACHABLE" };
  }
  const cost = path.length * state.rules.moveCostPerTile;
  if (cost > player.actionPoints) {
    return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  }
  return { ok: true, path, cost };
}

/** Tiles `player` could legally move to right now. Used by the client to highlight options. */
export function legalMoveDestinations(state: GameState, playerId: PlayerId): Position[] {
  const player = state.players.find((p) => p.id === playerId);
  if (player === undefined) return [];
  const isPassable = passabilityFor(state, { kind: "survivor", id: player.id });
  return reachablePositions(state.map, player.position, affordableSteps(state, player), isPassable);
}
