import { barrierId, containerId, itemId, zombieId, type MatchId, type PlayerId } from "../ids.js";
import type { MapLayout } from "../map/asciiMap.js";
import { createRng, deriveSeed, RNG_STREAM } from "../random/rng.js";
import { pickWeighted } from "../random/weighted.js";
import { firstEligiblePlayer } from "../turn/turnOrder.js";
import { createObjective } from "../objectives/createObjective.js";
import type {
  LootTableEntry,
  ObjectiveSettings,
  SurvivorDefinition,
  ZombieSpawnTableEntry,
} from "./definitions.js";
import type {
  Barrier,
  GameRules,
  GameState,
  GroundItem,
  PlayerState,
  SearchableContainer,
  WeaponType,
  ZombieState,
} from "./types.js";
import { validateMatchSetup } from "./validateSetup.js";

export interface MatchSetup {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly rules: GameRules;
  readonly survivor: SurvivorDefinition;
  readonly objective: ObjectiveSettings;
  /** Weighted item types rolled for each loot spawn on the layout. Empty means no loot. */
  readonly lootTable: readonly LootTableEntry[];
  /** Weighted zombie types rolled for each zombie spawn on the layout. */
  readonly zombieSpawnTable: readonly ZombieSpawnTableEntry[];
  readonly layout: MapLayout;
  /** In turn order. Between 1 and the number of spawn positions in the layout. */
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[];
}

/** Validation guarantees the starting weapon is a firearm; this narrows it for the loaded count. */
function magazineSizeOf(rules: GameRules, type: WeaponType): number {
  const weapon = rules.weaponDefinitions[type];
  return weapon.kind === "firearm" ? weapon.magazineSize : 0;
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
        loadedAmmo: magazineSizeOf(setup.rules, setup.survivor.startingWeapon),
      },
      meleeWeapon: setup.survivor.startingMeleeWeapon,
      reserveAmmo: setup.survivor.startingReserveAmmo,
      inventory: [],
      inventoryCapacity: setup.survivor.inventoryCapacity,
      present: true,
    };
  });

  const spawnRng = createRng(deriveSeed(setup.seed, RNG_STREAM.zombieSpawns));
  const zombies: ZombieState[] = layout.zombieSpawns.map((spawn, index) => {
    const type = pickWeighted(setup.zombieSpawnTable, spawnRng);
    return {
      id: zombieId(`z${index + 1}`),
      type,
      position: spawn,
      health: setup.rules.zombieDefinitions[type].maxHealth,
    };
  });

  const lootRng = createRng(deriveSeed(setup.seed, RNG_STREAM.loot));
  const items: GroundItem[] = layout.lootSpawns.map((position, index) => ({
    id: itemId(`i${index + 1}`),
    type: pickWeighted(setup.lootTable, lootRng),
    position,
  }));

  const containers: SearchableContainer[] = layout.containers.map((spawn, index) => ({
    id: containerId(`c${index + 1}`),
    category: spawn.category,
    position: spawn.position,
    searched: false,
  }));

  const barriers: Barrier[] = layout.barriers.map((spawn, index) => ({
    id: barrierId(`b${index + 1}`),
    kind: spawn.kind,
    position: spawn.position,
    state: spawn.state,
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
    containers,
    barriers,
    noises: [],
    noiseCounter: 0,
    objective: createObjective(layout, setup.objective),
  };

  // Every player is present at creation, so an eligible player always exists here.
  const first = firstEligiblePlayer({ ...withoutPhase, phase: { kind: "end_of_round" } });
  if (first === undefined) {
    throw new Error("createInitialState: no eligible first player");
  }
  return { ...withoutPhase, phase: { kind: "player_turn", activePlayerId: first } };
}
