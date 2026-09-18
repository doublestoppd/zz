export {
  canStandOn,
  isOccupied,
  isOccupiedByPlayer,
  passabilityFor,
  type Mover,
} from "./occupancy.js";
export {
  affordableSteps,
  legalMoveDestinations,
  validateMove,
  type MoveRejectionReason,
  type MoveValidation,
} from "./movement.js";
export {
  damagePlayer,
  damageZombie,
  type DamageOutcome,
  type ZombieDamageOutcome,
} from "./health.js";
export { hasLineOfSight, tilesBetween, type VisionBoard } from "./lineOfSight.js";
export {
  legalFireTargets,
  validateFire,
  validateReload,
  weaponOf,
  type FireRejectionReason,
  type FireValidation,
  type ReloadRejectionReason,
  type ReloadValidation,
} from "./combat.js";
export {
  itemsUnderPlayer,
  removeFromInventory,
  validatePickUp,
  validateUseItem,
  type PickUpRejectionReason,
  type PickUpValidation,
  type UseItemRejectionReason,
  type UseItemValidation,
} from "./items.js";
export {
  rollSearchLoot,
  SEARCH_REACH,
  searchableContainersInReach,
  validateSearch,
  type SearchRejectionReason,
  type SearchValidation,
} from "./search.js";
export { canHear, decayNoises, makeNoise, noiseScore, type NoiseOutcome } from "./noise.js";
export {
  BARRIER_REACH,
  barrierAt,
  barrierBlocksMovement,
  barrierBlocksVision,
  barrierOptions,
  carriesKey,
  isBlockedByBarrier,
  isForceable,
  validateCloseDoor,
  validateForceEntry,
  validateOpenDoor,
  type BarrierOptions,
  type BarrierRejectionReason,
  type CloseDoorValidation,
  type ForceEntryValidation,
  type OpenDoorValidation,
} from "./barriers.js";
