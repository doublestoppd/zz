/**
 * Seeded procedural city generation. `generateCity` returns the same `MapLayout` shape as
 * the hand-authored fixtures in game-core, so the rest of the game does not know which
 * one it is playing on.
 */
export { generateCity, DEFAULT_CITY_OPTIONS, type CityOptions } from "./city.js";
export {
  validateLayout,
  type LayoutExpectations,
  type ValidationResult,
} from "./validate/validateLayout.js";
export { BUILDING_TEMPLATES, type BuildingTemplate } from "./templates/buildings.js";
