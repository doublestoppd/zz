import { NO_MODIFIERS, type SpecialtyDefinition, type SpecialtyType } from "@zombie/game-core";

/**
 * One entry per `SpecialtyType`; the compiler rejects a missing one. Every survivor can
 * still move, fight, search, heal, open doors, and extract: a specialty only changes the
 * action economy of one activity, in whole action points or whole items, never percentages.
 */
export const SPECIALTY_DEFINITIONS: Readonly<Record<SpecialtyType, SpecialtyDefinition>> = {
  survivor: {
    name: "Survivor",
    description: "No specialty. Everything at the standard cost.",
    modifiers: NO_MODIFIERS,
  },
  paramedic: {
    name: "Paramedic",
    description: "Bandages and medkits heal 2 more.",
    modifiers: { ...NO_MODIFIERS, healBonus: 2 },
  },
  officer: {
    name: "Police officer",
    description: "Reloading costs no action points.",
    modifiers: { ...NO_MODIFIERS, reloadActionPointDiscount: 1 },
  },
  mechanic: {
    name: "Mechanic",
    description: "Forcing a door or window costs 1 AP instead of 2 and is 3 tiles quieter.",
    modifiers: { ...NO_MODIFIERS, forceEntryActionPointDiscount: 1, forceEntryNoiseReduction: 3 },
  },
  athlete: {
    name: "Athlete",
    description: "5 action points a turn instead of 4.",
    modifiers: { ...NO_MODIFIERS, extraActionPoints: 1 },
  },
  scavenger: {
    name: "Scavenger",
    description: "Searching costs 1 AP instead of 2 and draws one extra item.",
    modifiers: { ...NO_MODIFIERS, searchActionPointDiscount: 1, searchExtraRolls: 1 },
  },
};
