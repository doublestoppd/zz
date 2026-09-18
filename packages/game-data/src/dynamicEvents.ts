import type { DynamicEventRules } from "@zombie/game-core";

/**
 * Replay variation from the systems already built. A car alarm is a long, loud noise at a
 * zombie spawn (zombies converge there, away from you or toward you); a horde is an extra
 * reinforcement wave; a supply cache is loot dropped a short detour away. The roll
 * happens at the end of a round, only from threat level 1, and never two rounds running.
 */
export const DYNAMIC_EVENT_RULES: DynamicEventRules = {
  chancePerLevel: [0, 15, 25, 35, 45],
  minRoundsBetween: 2,
  pool: [
    { type: "car_alarm", weight: 3, minThreat: 1 },
    { type: "supply_cache", weight: 3, minThreat: 1 },
    { type: "horde", weight: 2, minThreat: 2 },
  ],
  alarmIntensity: 15,
  alarmRounds: 3,
  hordeSize: 3,
  cacheSize: 2,
  cacheTable: [
    { type: "ammo_box", weight: 3 },
    { type: "shell_box", weight: 2 },
    { type: "rifle_clip", weight: 2 },
    { type: "medkit", weight: 2 },
    { type: "bandage", weight: 2 },
  ],
  cacheMinDistance: 3,
  cacheMaxDistance: 7,
};
