import { parseAsciiMap, type MapLayout } from "./asciiMap.js";

/**
 * The hard-coded map used by Milestone 1 and by tests. Four spawns on the left,
 * an extraction zone on the right, and a few walls to make pathing non-trivial.
 * Replaced by procedural generation in a later milestone; the `MapLayout` shape stays.
 */
export const SMALL_TEST_MAP: MapLayout = parseAsciiMap([
  "################",
  "#S.....#.......#",
  "#S.....#..###..#",
  "#S.....#..#EE..#",
  "#S..#..#..#EE..#",
  "#...#..........#",
  "#...####..######",
  "#..............#",
  "#......##......#",
  "################",
]);
