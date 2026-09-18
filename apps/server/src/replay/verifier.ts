import {
  createInitialState,
  replayJournal,
  SIMULATION_VERSION,
  SMALL_TEST_MAP,
  type MapLayout,
  type MatchJournal,
  type ReplayVerdict,
} from "@zombie/game-core";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import { DEFAULT_CITY_OPTIONS, generateCity } from "@zombie/map-generation";

/** Hand-authored boards a journal may name. */
const FIXTURES: Readonly<Record<string, MapLayout>> = { SMALL_TEST_MAP };

/** Rebuilds the board a journal was recorded on from its layout source. */
export function rebuildLayout(journal: MatchJournal): MapLayout {
  const { layout } = journal.metadata;
  if (layout.kind === "fixture") {
    const fixture = FIXTURES[layout.name];
    if (fixture === undefined) throw new Error(`replay: unknown fixture "${layout.name}"`);
    return fixture;
  }
  return generateCity({ ...DEFAULT_CITY_OPTIONS, ...layout.options, seed: journal.metadata.seed });
}

/**
 * Rebuilds the initial state from the journal's metadata and this build's rule tables.
 * A different build with different tables is caught by the initial checkpoint.
 */
export function rebuildInitialState(journal: MatchJournal) {
  const { metadata } = journal;
  return createInitialState({
    matchId: metadata.matchId,
    seed: metadata.seed,
    rules: DEFAULT_GAME_RULES,
    survivor: DEFAULT_SURVIVOR,
    scenario: SCENARIOS[metadata.scenario],
    lootTable: LOOT_TABLE,
    zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
    layout: rebuildLayout(journal),
    players: metadata.players.map((p) => ({
      id: p.id as Parameters<typeof createInitialState>[0]["players"][number]["id"],
      name: p.name,
      specialty: p.specialty,
    })),
  });
}

/** Re-simulates a recorded match with this build and reports the first divergence, if any. */
export function verifyJournal(journal: MatchJournal): ReplayVerdict {
  if (journal.metadata.simulationVersion !== SIMULATION_VERSION) {
    // Refused before any state is rebuilt: an old journal must never look "almost right".
    return {
      ok: false,
      reason: "UNSUPPORTED_SIMULATION_VERSION",
      recorded: journal.metadata.simulationVersion,
      supported: SIMULATION_VERSION,
    };
  }
  return replayJournal(journal, rebuildInitialState(journal));
}
