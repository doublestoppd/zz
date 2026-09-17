export {
  firstEligiblePlayer,
  hasEligiblePlayer,
  isEligibleToAct,
  nextEligiblePlayerAfter,
} from "./turnOrder.js";
export {
  advanceUntilPlayerInput,
  endActiveTurn,
  reassignTurnIfActivePlayerAbsent,
  resolveEndOfRound,
  resolveZombiePhase,
  type Transition,
} from "./phases.js";
