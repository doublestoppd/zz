import { zombieId, type MatchId, type PlayerId } from "../ids.js";
import type { MapLayout } from "../map/asciiMap.js";
import { deriveSeed, RNG_STREAM } from "../random/rng.js";
import { firstEligiblePlayer } from "../turn/turnOrder.js";
import type { ExtractionSettings, SurvivorDefinition } from "./definitions.js";
import type { GameRules, GameState, PlayerState, ZombieState } from "./types.js";

export interface MatchSetup {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly rules: GameRules;
  readonly survivor: SurvivorDefinition;
  readonly extraction: ExtractionSettings;
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
  if (players.length === 0) {
    throw new Error("createInitialState: a match needs at least one player");
  }
  if (players.length > layout.spawnPositions.length) {
    throw new Error(
      `createInitialState: ${players.length} players but only ${layout.spawnPositions.length} spawn positions`,
    );
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) {
    throw new Error("createInitialState: duplicate player ids");
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
      present: true,
    };
  });

  const zombies: ZombieState[] = layout.zombieSpawns.map((spawn, index) => ({
    id: zombieId(`z${index + 1}`),
    type: "walker",
    position: spawn,
    health: setup.rules.zombieDefinitions.walker.maxHealth,
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
