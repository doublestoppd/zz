/** Starting statistics for a survivor. Values come from game-data. */
export interface SurvivorDefinition {
  readonly maxHealth: number;
  readonly maxActionPoints: number;
}

/** Statistics for one zombie type. Values come from game-data. */
export interface ZombieDefinition {
  readonly maxHealth: number;
  /** Health removed from a survivor by one attack. */
  readonly damage: number;
}
