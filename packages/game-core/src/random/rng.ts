/**
 * Seeded random number source for authoritative simulation.
 *
 * Authoritative code never calls Math.random(); it takes an `Rng` as an explicit parameter.
 * The generator's whole state is one 32-bit integer, which `GameState.rngState` carries so
 * that any snapshot plus the commands that follow it replays identically.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** One element chosen uniformly. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** The state to store; `createRng(getState())` continues the same sequence. */
  getState(): number;
}

/** mulberry32: tiny, fast, and good enough for gameplay randomness. */
export function createRng(initialState: number): Rng {
  let state = initialState >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max (${max}) < min (${min})`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick: empty list");
      const index = Math.floor(next() * items.length);
      return items[index] as (typeof items)[number];
    },
    getState: () => state,
  };
}

/**
 * Derives an independent 32-bit seed for a named stream (e.g. map generation vs gameplay)
 * from the match seed, so consuming gameplay randomness never changes the generated map.
 */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Named streams derived from the match seed. Add a member rather than reusing a number. */
export const RNG_STREAM = {
  gameplay: 0,
  mapGeneration: 1,
  loot: 2,
  zombieSpawns: 3,
  /** Per-container search loot; combined with the container id so search order never matters. */
  search: 4,
} as const;
