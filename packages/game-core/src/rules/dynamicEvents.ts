import type { GameEvent } from "../events/types.js";
import { itemId } from "../ids.js";
import { chebyshevDistance, isInBounds, tileAt } from "../map/position.js";
import type { Position } from "../map/types.js";
import type { Rng } from "../random/rng.js";
import { pickWeighted } from "../random/weighted.js";
import { isBlockedByBarrier } from "../state/barriers.js";
import type { DynamicEventType, GameState, GroundItem } from "../state/types.js";
import { makeNoise } from "./noise.js";
import { isOccupied } from "./occupancy.js";
import { spawnWave } from "./threat.js";

export interface DynamicEventOutcome {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * Rolls for one dynamic event at the end of a round. The chance depends on the threat
 * level, no event fires within `minRoundsBetween` rounds of the last one, and the event
 * is drawn from the pool entries whose `minThreat` the level meets. Every event composes
 * an existing system: a car alarm is a long noise, a horde is a reinforcement wave, a
 * supply cache is ground loot. Randomness comes from `rng` only, so it replays.
 */
export function rollDynamicEvent(state: GameState, rng: Rng): DynamicEventOutcome {
  const rules = state.rules.dynamicEvents;
  const chance = rules.chancePerLevel[state.threat] ?? 0;
  if (chance <= 0) return { state, events: [] };
  if (state.lastEventRound > 0 && state.round - state.lastEventRound < rules.minRoundsBetween) {
    return { state, events: [] };
  }
  if (rng.int(1, 100) > chance) return { state, events: [] };
  const eligible = rules.pool.filter((entry) => entry.minThreat <= state.threat);
  if (eligible.length === 0) return { state, events: [] };
  const type = pickWeighted(eligible, rng);
  const fired = fire(state, rng, type);
  if (fired === undefined) return { state, events: [] };
  return {
    state: { ...fired.state, lastEventRound: state.round },
    events: [{ type: "dynamic_event", event: type, position: fired.position }, ...fired.events],
  };
}

interface Fired {
  readonly state: GameState;
  readonly position: Position | undefined;
  readonly events: readonly GameEvent[];
}

function fire(state: GameState, rng: Rng, type: DynamicEventType): Fired | undefined {
  const rules = state.rules.dynamicEvents;
  switch (type) {
    case "car_alarm": {
      // A parked car at one of the outskirts; whoever stands there is just closer to it.
      if (state.reinforcementSpawns.length === 0) return undefined;
      const position = rng.pick(state.reinforcementSpawns);
      const noise = makeNoise(state, position, rules.alarmIntensity, "alarm", rules.alarmRounds);
      return { state: noise.state, position, events: noise.events };
    }
    case "horde": {
      const table =
        state.rules.threat.spawnTables[state.threat] ??
        state.rules.threat.spawnTables[state.rules.threat.spawnTables.length - 1];
      if (table === undefined) return undefined;
      const wave = spawnWave(state, rng, rules.hordeSize, table);
      if (wave.events.length === 0) return undefined;
      return { state: wave.state, position: undefined, events: wave.events };
    }
    case "supply_cache": {
      const spot = cacheSpot(state, rng);
      if (spot === undefined) return undefined;
      const items: GroundItem[] = [];
      for (let i = 0; i < rules.cacheSize; i += 1) {
        items.push({
          id: itemId(`cache${state.round}-${i + 1}`),
          type: pickWeighted(rules.cacheTable, rng),
          position: spot,
        });
      }
      return {
        state: { ...state, items: [...state.items, ...items] },
        position: spot,
        events: items.map((item) => ({
          type: "item_dropped" as const,
          itemId: item.id,
          itemType: item.type,
          position: spot,
        })),
      };
    }
  }
}

/**
 * A free walkable tile between `cacheMinDistance` and `cacheMaxDistance` of some standing
 * survivor: close enough to tempt, far enough to cost a detour. Undefined when none exists.
 */
function cacheSpot(state: GameState, rng: Rng): Position | undefined {
  const rules = state.rules.dynamicEvents;
  const standing = state.players.filter((p) => p.status === "active");
  const candidates: Position[] = [];
  for (let y = 0; y < state.map.height; y += 1) {
    for (let x = 0; x < state.map.width; x += 1) {
      const p = { x, y };
      if (!isInBounds(state.map, p) || !(tileAt(state.map, p)?.walkable ?? false)) continue;
      if (isBlockedByBarrier(state, p) || isOccupied(state, p)) continue;
      if (state.items.some((i) => i.position.x === x && i.position.y === y)) continue;
      const nearest = Math.min(...standing.map((s) => chebyshevDistance(s.position, p)));
      if (nearest >= rules.cacheMinDistance && nearest <= rules.cacheMaxDistance)
        candidates.push(p);
    }
  }
  return candidates.length === 0 ? undefined : rng.pick(candidates);
}
