export { isOccupied, isOccupiedByPlayer } from "./occupancy.js";
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
