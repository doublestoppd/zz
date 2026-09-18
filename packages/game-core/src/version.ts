/**
 * Which deterministic gameplay semantics this build of game-core produces. Bump it when a
 * change alters what a recorded sequence of commands does (rules, RNG consumption, phase
 * order, tie-breaking, generation), never for presentation or protocol changes. A journal
 * recorded under another simulation version is refused by the replay verifier rather than
 * replayed into silent divergence. The bump rules are in docs/DEVELOPMENT.md.
 */
export const SIMULATION_VERSION = 1;
