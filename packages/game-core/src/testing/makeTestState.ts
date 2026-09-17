import { matchId, playerId, type PlayerId } from "../ids.js";
import { parseAsciiMap, type MapLayout } from "../map/asciiMap.js";
import { createInitialState } from "../state/createInitialState.js";
import type { GameState } from "../state/types.js";

/**
 * Test-only builder. A 8x6 room with two pillars, four spawns down the left column,
 * and no zombies unless a layout with `Z` markers is supplied.
 *
 *   ########
 *   #S.....#
 *   #S.#...#
 *   #S.#...#
 *   #S.....#
 *   ########
 */
export const TEST_LAYOUT: MapLayout = parseAsciiMap([
  "########",
  "#S.....#",
  "#S.#...#",
  "#S.#...#",
  "#S.....#",
  "########",
]);

export const P1 = playerId("p1");
export const P2 = playerId("p2");
export const P3 = playerId("p3");

export interface TestStateOptions {
  readonly players?: readonly PlayerId[];
  readonly maxActionPoints?: number;
  readonly moveCostPerTile?: number;
  readonly layout?: MapLayout;
  readonly seed?: number;
  readonly zombieDamage?: number;
  readonly zombieHealth?: number;
}

export function makeTestState(options: TestStateOptions = {}): GameState {
  const players = options.players ?? [P1, P2];
  return createInitialState({
    matchId: matchId("test-match"),
    seed: options.seed ?? 42,
    rules: {
      moveCostPerTile: options.moveCostPerTile ?? 1,
      zombieDefinitions: {
        walker: { maxHealth: options.zombieHealth ?? 3, damage: options.zombieDamage ?? 2 },
      },
    },
    survivor: { maxHealth: 10, maxActionPoints: options.maxActionPoints ?? 4 },
    layout: options.layout ?? TEST_LAYOUT,
    players: players.map((id) => ({ id, name: id })),
  });
}
