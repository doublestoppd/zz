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
export { hasLineOfSight, tilesBetween } from "./lineOfSight.js";
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
