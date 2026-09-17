import type { Rng } from "./rng.js";

export interface WeightedEntry<T> {
  readonly type: T;
  readonly weight: number;
}

/**
 * Chooses one entry with probability proportional to its weight. Deterministic given the
 * rng. Throws on an empty table or non-positive total weight; callers validate tables up
 * front (see state/validateSetup.ts) so this only guards programmer mistakes.
 */
export function pickWeighted<T>(table: readonly WeightedEntry<T>[], rng: Rng): T {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  const first = table[0];
  if (first === undefined || total <= 0) throw new Error("pickWeighted: empty table");
  let roll = rng.next() * total;
  let chosen = first.type;
  for (const entry of table) {
    roll -= entry.weight;
    chosen = entry.type;
    if (roll < 0) break;
  }
  return chosen;
}
