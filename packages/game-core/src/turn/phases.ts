import type { GameEvent } from "../events/types.js";
import type { PlayerId } from "../ids.js";
import { createRng, type Rng } from "../random/rng.js";
import type { GamePhase, GameState, MatchOutcome } from "../state/types.js";
import { evaluateObjective } from "../objectives/objective.js";
import { decayNoises } from "../rules/noise.js";
import { runZombiePhase } from "../zombies/zombiePhase.js";
import {
  firstEligiblePlayer,
  firstStandingPlayer,
  hasEligiblePlayer,
  isEligibleToAct,
  nextEligiblePlayerAfter,
} from "./turnOrder.js";

/** A state transition together with the events that describe it. */
export interface Transition {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

function setPhase(state: GameState, phase: GamePhase): Transition {
  return { state: { ...state, phase }, events: [{ type: "phase_changed", phase }] };
}

function startPlayerTurn(state: GameState, playerId: PlayerId): Transition {
  const phase: GamePhase = { kind: "player_turn", activePlayerId: playerId };
  return {
    state: { ...state, phase },
    events: [
      { type: "phase_changed", phase },
      { type: "turn_started", playerId, round: state.round },
    ],
  };
}

/**
 * Ends the active player's turn. The next eligible player in turn order becomes active;
 * when none remains, the round proceeds to the zombie phase.
 * Precondition: `state.phase.kind === "player_turn"`.
 */
export function endActiveTurn(state: GameState): Transition {
  if (state.phase.kind !== "player_turn") {
    throw new Error(`endActiveTurn: expected player_turn, got ${state.phase.kind}`);
  }
  const ended: GameEvent = { type: "turn_ended", playerId: state.phase.activePlayerId };
  const next = nextEligiblePlayerAfter(state, state.phase.activePlayerId);
  const transition =
    next === undefined ? setPhase(state, { kind: "zombie_phase" }) : startPlayerTurn(state, next);
  return { state: transition.state, events: [ended, ...transition.events] };
}

/**
 * Runs every zombie's action for the round (zombies/zombiePhase.ts). Any randomness
 * consumed must come from `rng`, and the final `rng.getState()` is written back to
 * `rngState` so snapshots stay replayable.
 * Precondition: `state.phase.kind === "zombie_phase"`.
 */
export function resolveZombiePhase(state: GameState, rng: Rng): Transition {
  if (state.phase.kind !== "zombie_phase") {
    throw new Error(`resolveZombiePhase: expected zombie_phase, got ${state.phase.kind}`);
  }
  const zombies = runZombiePhase(state, rng);
  // Noises are heard during the phase above, then age; a noise made this round is thus
  // evaluated in `noiseDurationRounds` consecutive zombie phases.
  const withRng: GameState = { ...decayNoises(zombies.state), rngState: rng.getState() };
  const next = setPhase(withRng, { kind: "end_of_round" });
  return { state: next.state, events: [...zombies.events, ...next.events] };
}

/**
 * Closes the round. Defeat when every survivor is down; otherwise the objective is
 * evaluated and may end the match in victory; otherwise action points are refilled and the
 * next round starts with the first eligible player.
 * Precondition: `state.phase.kind === "end_of_round"`.
 */
export function resolveEndOfRound(state: GameState): Transition {
  if (state.phase.kind !== "end_of_round") {
    throw new Error(`resolveEndOfRound: expected end_of_round, got ${state.phase.kind}`);
  }
  if (state.players.every((p) => p.status === "down")) {
    return finishMatch(state, "defeat", []);
  }
  const objective = evaluateObjective(state);
  const evaluated: GameState = { ...state, objective: objective.objective };
  if (objective.outcome !== undefined) {
    return finishMatch(evaluated, objective.outcome, objective.events);
  }
  const nextRound = state.round + 1;
  const refilled: GameState = {
    ...evaluated,
    round: nextRound,
    players: evaluated.players.map((p) => ({ ...p, actionPoints: p.maxActionPoints })),
  };
  const roundStarted: GameEvent = { type: "round_started", round: nextRound };
  // Nobody present: pause on the first standing survivor (never a down one, so the active
  // player is always someone who could act). `set_player_presence` hands the turn over as
  // soon as somebody eligible returns. A standing survivor exists because the all-down
  // defeat check ran above.
  const active = firstEligiblePlayer(refilled) ?? firstStandingPlayer(refilled);
  if (active === undefined) throw new Error("resolveEndOfRound: no standing survivor");
  const turn = startPlayerTurn(refilled, active);
  return { state: turn.state, events: [...objective.events, roundStarted, ...turn.events] };
}

function finishMatch(
  state: GameState,
  outcome: MatchOutcome,
  before: readonly GameEvent[],
): Transition {
  const finished = setPhase(state, { kind: "finished", outcome });
  return {
    state: finished.state,
    events: [...before, ...finished.events, { type: "match_ended", outcome }],
  };
}

/**
 * Drives the non-player phases until the match waits on a player or is finished.
 * This is the single place the server needs to call after any accepted command.
 * The gameplay Rng is rebuilt from `state.rngState`, so this function is deterministic.
 */
export function advanceUntilPlayerInput(state: GameState): Transition {
  let current = state;
  const events: GameEvent[] = [];
  // Bounded loop: each iteration moves strictly forward through zombie -> end_of_round -> player_turn.
  for (let guard = 0; guard < 4; guard += 1) {
    switch (current.phase.kind) {
      case "player_turn":
      case "finished":
        return { state: current, events };
      case "zombie_phase": {
        const t = resolveZombiePhase(current, createRng(current.rngState));
        current = t.state;
        events.push(...t.events);
        break;
      }
      case "end_of_round": {
        const t = resolveEndOfRound(current);
        current = t.state;
        events.push(...t.events);
        break;
      }
    }
  }
  throw new Error("advanceUntilPlayerInput: phases did not settle");
}

/**
 * Enforces the invariant "a survivor who cannot act never holds the turn while someone
 * eligible could". Called after presence changes. No-op in every other situation.
 */
export function reassignTurnIfActivePlayerIneligible(state: GameState): Transition {
  if (state.phase.kind !== "player_turn") return { state, events: [] };
  const activeId = state.phase.activePlayerId;
  const active = state.players.find((p) => p.id === activeId);
  if (active === undefined || isEligibleToAct(active)) return { state, events: [] };
  if (!hasEligiblePlayer(state)) return { state, events: [] };
  const ended = endActiveTurn(state);
  const settled = advanceUntilPlayerInput(ended.state);
  return { state: settled.state, events: [...ended.events, ...settled.events] };
}
