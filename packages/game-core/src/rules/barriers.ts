import type { BarrierId } from "../ids.js";
import type { Barrier, GameState, PlayerState } from "../state/types.js";
import { isOccupied } from "./occupancy.js";
import { discounted, modifiersOf } from "./specialties.js";

/** A survivor may work a door or window from their own tile or an orthogonally adjacent one. */
export const BARRIER_REACH = 1;

export type BarrierRejectionReason =
  | "BARRIER_NOT_FOUND"
  | "BARRIER_OUT_OF_REACH"
  | "NOT_A_DOOR"
  | "DOOR_LOCKED"
  | "DOOR_ALREADY_OPEN"
  | "DOOR_ALREADY_CLOSED"
  | "DOOR_BROKEN"
  | "DOOR_OBSTRUCTED"
  | "BARRIER_NOT_FORCEABLE"
  | "INSUFFICIENT_ACTION_POINTS";

export type OpenDoorValidation =
  | {
      readonly ok: true;
      readonly barrier: Barrier;
      readonly cost: number;
      /** True when the door was locked and a carried key is spent to open it. */
      readonly usesKey: boolean;
    }
  | { readonly ok: false; readonly reason: BarrierRejectionReason };

export type CloseDoorValidation =
  | { readonly ok: true; readonly barrier: Barrier; readonly cost: number }
  | { readonly ok: false; readonly reason: BarrierRejectionReason };

export type ForceEntryValidation =
  | {
      readonly ok: true;
      readonly barrier: Barrier;
      readonly cost: number;
      /** Intensity of the noise the forcing will make. */
      readonly noise: number;
    }
  | { readonly ok: false; readonly reason: BarrierRejectionReason };

export {
  barrierAt,
  barrierBlocksMovement,
  barrierBlocksVision,
  isBlockedByBarrier,
} from "../state/barriers.js";

function inReach(player: PlayerState, barrier: Barrier): boolean {
  const dx = Math.abs(player.position.x - barrier.position.x);
  const dy = Math.abs(player.position.y - barrier.position.y);
  return dx + dy <= BARRIER_REACH;
}

/** True when the survivor carries at least one key. */
export function carriesKey(state: GameState, player: PlayerState): boolean {
  return player.inventory.some((type) => state.rules.itemDefinitions[type].effect.kind === "key");
}

function lookUp(
  state: GameState,
  player: PlayerState,
  id: BarrierId,
):
  | { readonly ok: true; readonly barrier: Barrier }
  | { readonly ok: false; readonly reason: BarrierRejectionReason } {
  const barrier = state.barriers.find((b) => b.id === id);
  if (barrier === undefined) return { ok: false, reason: "BARRIER_NOT_FOUND" };
  if (!inReach(player, barrier)) return { ok: false, reason: "BARRIER_OUT_OF_REACH" };
  return { ok: true, barrier };
}

/**
 * Reasons in order: the barrier exists, it is in reach, it is a door, its state allows
 * opening (a locked door needs a carried key), action points. Opening a locked door with a
 * key costs the same as opening a closed one; the key is consumed.
 */
export function validateOpenDoor(
  state: GameState,
  player: PlayerState,
  id: BarrierId,
): OpenDoorValidation {
  const found = lookUp(state, player, id);
  if (!found.ok) return found;
  const { barrier } = found;
  if (barrier.kind !== "door") return { ok: false, reason: "NOT_A_DOOR" };
  if (barrier.state === "open") return { ok: false, reason: "DOOR_ALREADY_OPEN" };
  if (barrier.state === "broken") return { ok: false, reason: "DOOR_BROKEN" };
  const usesKey = barrier.state === "locked";
  if (usesKey && !carriesKey(state, player)) return { ok: false, reason: "DOOR_LOCKED" };
  const cost = state.rules.openDoorActionPointCost;
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, barrier, cost, usesKey };
}

/**
 * Reasons in order: the barrier exists, it is in reach, it is a door, it is open, nobody
 * (the closer included) stands in the doorway, action points.
 */
export function validateCloseDoor(
  state: GameState,
  player: PlayerState,
  id: BarrierId,
): CloseDoorValidation {
  const found = lookUp(state, player, id);
  if (!found.ok) return found;
  const { barrier } = found;
  if (barrier.kind !== "door") return { ok: false, reason: "NOT_A_DOOR" };
  if (barrier.state === "broken") return { ok: false, reason: "DOOR_BROKEN" };
  if (barrier.state !== "open") return { ok: false, reason: "DOOR_ALREADY_CLOSED" };
  if (isOccupied(state, barrier.position)) return { ok: false, reason: "DOOR_OBSTRUCTED" };
  const cost = state.rules.closeDoorActionPointCost;
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, barrier, cost };
}

/** What may be forced: a locked door, or an intact window. A closed door is simply opened. */
export function isForceable(barrier: Barrier): boolean {
  return barrier.kind === "door" ? barrier.state === "locked" : barrier.state === "closed";
}

/**
 * Reasons in order: the barrier exists, it is in reach, it can be forced, action points.
 * Forcing breaks the barrier for good and makes a `forceEntryNoise` noise (handler).
 */
export function validateForceEntry(
  state: GameState,
  player: PlayerState,
  id: BarrierId,
): ForceEntryValidation {
  const found = lookUp(state, player, id);
  if (!found.ok) return found;
  const { barrier } = found;
  if (!isForceable(barrier)) return { ok: false, reason: "BARRIER_NOT_FORCEABLE" };
  const cost = discounted(
    state.rules.forceEntryActionPointCost,
    modifiersOf(state, player).forceEntryActionPointDiscount,
  );
  if (player.actionPoints < cost) return { ok: false, reason: "INSUFFICIENT_ACTION_POINTS" };
  return { ok: true, barrier, cost, noise: forceEntryNoiseFor(state, player) };
}

/** How loud this survivor's forced entry is: the rule number less their specialty's reduction. */
export function forceEntryNoiseFor(state: GameState, player: PlayerState): number {
  return discounted(
    state.rules.forceEntryNoise,
    modifiersOf(state, player).forceEntryNoiseReduction,
  );
}

/** What the survivor could do to nearby barriers right now. Used by the client for buttons and highlights. */
export interface BarrierOptions {
  readonly open: Barrier[];
  readonly close: Barrier[];
  readonly force: Barrier[];
}

export function barrierOptions(state: GameState, player: PlayerState): BarrierOptions {
  const open: Barrier[] = [];
  const close: Barrier[] = [];
  const force: Barrier[] = [];
  for (const barrier of state.barriers) {
    if (validateOpenDoor(state, player, barrier.id).ok) open.push(barrier);
    if (validateCloseDoor(state, player, barrier.id).ok) close.push(barrier);
    if (validateForceEntry(state, player, barrier.id).ok) force.push(barrier);
  }
  return { open, close, force };
}
