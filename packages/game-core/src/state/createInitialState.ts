import { itemId, zombieId, type MatchId, type PlayerId } from "../ids.js";
import type { MapLayout } from "../map/asciiMap.js";
import { createRng, deriveSeed, RNG_STREAM, type Rng } from "../random/rng.js";
import { firstEligiblePlayer } from "../turn/turnOrder.js";
import type { ExtractionSettings, LootTableEntry, SurvivorDefinition } from "./definitions.js";
import type { GameRules, GameState, GroundItem, PlayerState, ZombieState } from "./types.js";
import { validateMatchSetup } from "./validateSetup.js";

export interface MatchSetup {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly rules: GameRules;
  readonly survivor: SurvivorDefinition;
  readonly extraction: ExtractionSettings;
  /** Weighted item types rolled for each loot spawn on the layout. Empty means no loot. */
  readonly lootTable: readonly LootTableEntry[];
  readonly layout: MapLayout;
  /** In turn order. Between 1 and the number of spawn positions in the layout. */
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[];
}

/**
 * Builds the state for round 1 with the first player active.
 * Throws on configuration errors (these are programmer mistakes, not player rejections).
 */
export function createInitialState(setup: MatchSetup): GameState {
  const { layout, players } = setup;
  const issues = validateMatchSetup(setup);
  if (issues.length > 0) {
    throw new Error(`createInitialState: invalid setup\n- ${issues.join("\n- ")}`);
  }

  const playerStates: PlayerState[] = players.map((p, index) => {
    const spawn = layout.spawnPositions[index];
    if (spawn === undefined) throw new Error(`createInitialState: no spawn for player ${index}`);
    return {
      id: p.id,
      name: p.name,
      position: spawn,
      health: setup.survivor.maxHealth,
      maxHealth: setup.survivor.maxHealth,
      actionPoints: setup.survivor.maxActionPoints,
      maxActionPoints: setup.survivor.maxActionPoints,
      status: "active",
      weapon: {
        type: setup.survivor.startingWeapon,
        loadedAmmo: setup.rules.weaponDefinitions[setup.survivor.startingWeapon].magazineSize,
      },
      reserveAmmo: setup.survivor.startingReserveAmmo,
      inventory: [],
      inventoryCapacity: setup.survivor.inventoryCapacity,
      present: true,
    };
  });

  const zombies: ZombieState[] = layout.zombieSpawns.map((spawn, index) => ({
    id: zombieId(`z${index + 1}`),
    type: "walker",
    position: spawn,
    health: setup.rules.zombieDefinitions.walker.maxHealth,
  }));

  const lootRng = createRng(deriveSeed(setup.seed, RNG_STREAM.loot));
  const items: GroundItem[] = layout.lootSpawns.map((position, index) => ({
    id: itemId(`i${index + 1}`),
    type: rollLoot(setup.lootTable, lootRng),
    position,
  }));

  const withoutPhase: Omit<GameState, "phase"> = {
    matchId: setup.matchId,
    seed: setup.seed,
    rngState: deriveSeed(setup.seed, RNG_STREAM.gameplay),
    rules: setup.rules,
    round: 1,
    turnOrder: players.map((p) => p.id),
    map: layout.map,
    players: playerStates,
    zombies,
    items,
    objective: {
      kind: "extraction",
      extractionZone: layout.extractionZone,
      holdoutRounds: setup.extraction.holdoutRounds,
      roundsHeld: 0,
      status: "in_progress",
    },
  };

  // Every player is present at creation, so an eligible player always exists here.
  const first = firstEligiblePlayer({ ...withoutPhase, phase: { kind: "end_of_round" } });
  if (first === undefined) {
    throw new Error("createInitialState: no eligible first player");
  }
  return { ...withoutPhase, phase: { kind: "player_turn", activePlayerId: first } };
}

/** Weighted choice from the loot table. Deterministic given the rng. */
function rollLoot(table: readonly LootTableEntry[], rng: Rng): GroundItem["type"] {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  if (table.length === 0 || total <= 0) throw new Error("rollLoot: loot table is empty");
  let roll = rng.next() * total;
  let chosen = table[0]?.type;
  for (const entry of table) {
    roll -= entry.weight;
    chosen = entry.type;
    if (roll < 0) break;
  }
  if (chosen === undefined) throw new Error("rollLoot: loot table is empty");
  return chosen;
}
