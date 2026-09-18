/**
 * Performance budgets, in milliseconds unless named otherwise. Derived in
 * docs/PERFORMANCE.md from the measured medians and the hosting constraint (one Node
 * process, one thread, every match's commands on the same event loop): each budget is the
 * hosting-derived ceiling or ten times the measured median, whichever is smaller, so a
 * regression of an order of magnitude fails the suite while machine noise does not.
 */
export const BUDGETS = {
  /** End of round on the worst credible population (zombie phase, threat, events, objective). */
  endOfRoundHeavyMs: 50,
  /** End of round on the large map with the same population. */
  endOfRoundLargeMs: 50,
  /** A player command that does not end the round, including the critical invariant check. */
  playerCommandMs: 10,
  /** City generation inside `start_match`, default size. */
  generateCityDefaultMs: 100,
  /** City generation at twice the default size in each dimension. */
  generateCityLargeMs: 250,
  /** The journal checkpoint fingerprint of a large full state (runs on every accepted command). */
  fingerprintLargeMs: 30,
  /** The full invariant set on the heavy state. */
  invariantsFullMs: 5,
  /** One redacted `update` payload, default map with the heavy population. */
  updateBytesHeavy: 32 * 1024,
  /** One redacted `update` payload on the large map. */
  updateBytesLarge: 64 * 1024,
} as const;
