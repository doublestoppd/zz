import type { ThreatRules } from "@zombie/game-core";

/**
 * Pacing. Level 0 lasts the first four rounds (explore and scavenge); noise and objective
 * progress bring the next levels sooner; from level 1 reinforcement waves arrive on a
 * fixed schedule and grow faster and nastier. Everything here is data: change the feel of
 * a match without touching game-core.
 */
export const THREAT_RULES: ThreatRules = {
  roundsPerLevel: 4,
  /** Five pistol shots, or one shotgun blast and a forced window, buy a level. */
  heatPerLevel: 40,
  maxLevel: 4,
  reinforcementCount: [0, 1, 1, 2, 2],
  reinforcementInterval: [0, 3, 2, 2, 1],
  spawnTables: [
    [
      { type: "walker", weight: 6 },
      { type: "runner", weight: 2 },
      { type: "brute", weight: 1 },
    ],
    [
      { type: "walker", weight: 6 },
      { type: "runner", weight: 2 },
      { type: "brute", weight: 1 },
    ],
    [
      { type: "walker", weight: 5 },
      { type: "runner", weight: 4 },
      { type: "brute", weight: 1 },
    ],
    [
      { type: "walker", weight: 4 },
      { type: "runner", weight: 4 },
      { type: "brute", weight: 2 },
    ],
    [
      { type: "walker", weight: 3 },
      { type: "runner", weight: 4 },
      { type: "brute", weight: 3 },
    ],
  ],
  spawnMinDistance: 4,
};
