import type { SpecialtyModifiers } from "../state/definitions.js";
import type { GameState, PlayerState } from "../state/types.js";

/** Every modifier at zero: what a plain survivor gets, and the base other specialties add to. */
export const NO_MODIFIERS: SpecialtyModifiers = {
  extraActionPoints: 0,
  healBonus: 0,
  reloadActionPointDiscount: 0,
  forceEntryActionPointDiscount: 0,
  forceEntryNoiseReduction: 0,
  searchActionPointDiscount: 0,
  searchExtraRolls: 0,
};

/** The modifiers of a survivor's specialty. The single lookup every extension point uses. */
export function modifiersOf(state: GameState, player: PlayerState): SpecialtyModifiers {
  return state.rules.specialtyDefinitions[player.specialty].modifiers;
}

/** A cost or intensity after a discount, never below zero. */
export function discounted(base: number, discount: number): number {
  return Math.max(0, base - discount);
}
