import { positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { Barrier, BarrierState, GameState } from "./types.js";

/** What a barrier lookup needs: any object carrying the barrier list. */
export type BarrierBoard = Pick<GameState, "barriers">;

/** The barrier standing on `position`, if any. */
export function barrierAt(board: BarrierBoard, position: Position): Barrier | undefined {
  return board.barriers.find((b) => positionsEqual(b.position, position));
}

/**
 * Whether a barrier in this state stops movement. Closed and locked doors do; so does an
 * intact window (its `closed` state). Open and broken barriers are passable.
 */
export function barrierBlocksMovement(barrier: Barrier): boolean {
  return barrier.state === "closed" || barrier.state === "locked";
}

/**
 * Whether a barrier in this state stops sight. Doors are opaque when closed or locked.
 * Windows never block sight, intact or broken: that is what makes them windows.
 */
export function barrierBlocksVision(barrier: Barrier): boolean {
  return barrier.kind === "door" && barrierBlocksMovement(barrier);
}

/** True when a barrier on `position` currently stops movement. */
export function isBlockedByBarrier(board: BarrierBoard, position: Position): boolean {
  const barrier = barrierAt(board, position);
  return barrier !== undefined && barrierBlocksMovement(barrier);
}

/** A copy of `state` with one barrier's state changed. */
export function setBarrierState(
  state: GameState,
  id: Barrier["id"],
  next: BarrierState,
): GameState {
  return {
    ...state,
    barriers: state.barriers.map((b) => (b.id === id ? { ...b, state: next } : b)),
  };
}
