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
  damageAtDistance,
  firearmOf,
  legalFireTargets,
  legalMeleeTargets,
  meleeWeaponOf,
  validateFire,
  validateMelee,
  validateReload,
  type FireRejectionReason,
  type FireValidation,
  type MeleeRejectionReason,
  type MeleeValidation,
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
export { discounted, modifiersOf, NO_MODIFIERS } from "./specialties.js";
export { applyThreat, computeThreat, type ThreatOutcome } from "./threat.js";
export {
  emptyGrid,
  isVisible,
  revealExplored,
  visibilityGrid,
  visibleTiles,
} from "./visibility.js";
export {
  BARRIER_REACH,
  barrierAt,
  barrierBlocksMovement,
  barrierBlocksVision,
  barrierOptions,
  carriesKey,
  forceEntryNoiseFor,
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
