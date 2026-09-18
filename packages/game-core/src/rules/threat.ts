import type { GameEvent } from "../events/types.js";
import { zombieId } from "../ids.js";
import { chebyshevDistance, positionsEqual } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { Rng } from "../random/rng.js";
import { pickWeighted } from "../random/weighted.js";
import type { GameState, ZombieState } from "../state/types.js";
import { isOccupied } from "./occupancy.js";

/**
 * The threat level the board has earned, from three predictable inputs: rounds elapsed,
 * noise made (`heat`, the sum of every noise intensity so far), and objective steps
 * completed. Each input adds whole levels; the sum is capped at `maxLevel`.
 */
export function computeThreat(state: GameState): number {
  const { roundsPerLevel, heatPerLevel, maxLevel } = state.rules.threat;
  // Judged at the end of round `round`: rounds 1..roundsPerLevel are level 0 from time alone.
  const fromRounds = Math.floor(state.round / roundsPerLevel);
  const fromHeat = Math.floor(state.heat / heatPerLevel);
  const fromObjective = state.objective.current;
  return Math.min(maxLevel, fromRounds + fromHeat + fromObjective);
}

export interface ThreatOutcome {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Re-evaluates the threat level at the end of a round and, when the level's schedule says
 * so, spawns reinforcements: `reinforcementCount[level]` zombies every
 * `reinforcementInterval[level]` rounds (0 means never), each rolled from the level's
 * spawn table and placed on a free reinforcement spawn out of sight of every standing
 * survivor. Randomness comes from `rng` only, so the outcome replays.
 */
export function applyThreat(state: GameState, rng: Rng): ThreatOutcome {
  const events: GameEvent[] = [];
  const level = computeThreat(state);
  let current: GameState = state;
  if (level !== state.threat) {
    current = { ...current, threat: level };
    events.push({ type: "threat_changed", level, previous: state.threat });
  }
  const rules = current.rules.threat;
  const interval = rules.reinforcementInterval[level] ?? 0;
  const count = rules.reinforcementCount[level] ?? 0;
  if (interval <= 0 || count <= 0 || current.round % interval !== 0) {
    return { state: current, events };
  }
  const table = rules.spawnTables[level] ?? rules.spawnTables[rules.spawnTables.length - 1];
  if (table === undefined || table.length === 0) return { state: current, events };
  for (let i = 0; i < count; i += 1) {
    const spots = freeSpawns(current);
    if (spots.length === 0) break;
    const position = rng.pick(spots);
    const type = pickWeighted(table, rng);
    const id = zombieId(`z${current.zombieCounter + 1}`);
    const zombie: ZombieState = {
      id,
      type,
      position,
      health: current.rules.zombieDefinitions[type].maxHealth,
    };
    current = {
      ...current,
      zombies: [...current.zombies, zombie],
      zombieCounter: current.zombieCounter + 1,
    };
    events.push({ type: "zombie_spawned", zombieId: id, zombieType: type, position });
  }
  return { state: current, events };
}

/** Reinforcement spawns nobody stands on and no standing survivor is within `minDistance` of. */
function freeSpawns(state: GameState): Position[] {
  const standing = state.players.filter((p) => p.status === "active");
  return state.reinforcementSpawns.filter(
    (spot) =>
      !isOccupied(state, spot) &&
      standing.every(
        (p) => chebyshevDistance(p.position, spot) >= state.rules.threat.spawnMinDistance,
      ) &&
      !state.zombies.some((z) => positionsEqual(z.position, spot)),
  );
}
