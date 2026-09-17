import type { GameEvent } from "../events/types.js";
import type { PlayerId } from "../ids.js";
import { createRng, type Rng } from "../random/rng.js";
import type { GamePhase, GameState } from "../state/types.js";
import { firstEligiblePlayer, hasEligiblePlayer, nextEligiblePlayerAfter } from "./turnOrder.js";

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
 * Runs every zombie's action for the round. There are no zombies yet, so the phase passes
 * straight through. Any randomness consumed here must come from `rng`, and the final
 * `rng.getState()` must be written back to `rngState` so snapshots stay replayable.
 * Precondition: `state.phase.kind === "zombie_phase"`.
 */
export function resolveZombiePhase(state: GameState, rng: Rng): Transition {
  if (state.phase.kind !== "zombie_phase") {
    throw new Error(`resolveZombiePhase: expected zombie_phase, got ${state.phase.kind}`);
  }
  const withRng: GameState = { ...state, rngState: rng.getState() };
  return setPhase(withRng, { kind: "end_of_round" });
}

/**
 * Closes the round: refills action points and starts the next round with the first
 * eligible player. Objective evaluation is added here in the objective milestone.
 * Precondition: `state.phase.kind === "end_of_round"`.
 */
export function resolveEndOfRound(state: GameState): Transition {
  if (state.phase.kind !== "end_of_round") {
    throw new Error(`resolveEndOfRound: expected end_of_round, got ${state.phase.kind}`);
  }
  const nextRound = state.round + 1;
  const refilled: GameState = {
    ...state,
    round: nextRound,
    players: state.players.map((p) => ({ ...p, actionPoints: p.maxActionPoints })),
  };
  const roundStarted: GameEvent = { type: "round_started", round: nextRound };
  const first = firstEligiblePlayer(refilled);
  // Nobody present: keep the first player in turn order as the (paused) active player.
  // `set_player_presence` hands the turn over as soon as somebody returns.
  const active = first ?? refilled.turnOrder[0];
  if (active === undefined) throw new Error("resolveEndOfRound: match has no players");
  const turn = startPlayerTurn(refilled, active);
  return { state: turn.state, events: [roundStarted, ...turn.events] };
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
 * Enforces the invariant "an absent player never holds the turn while someone present
 * could act". Called after presence changes. No-op in every other situation.
 */
export function reassignTurnIfActivePlayerAbsent(state: GameState): Transition {
  if (state.phase.kind !== "player_turn") return { state, events: [] };
  const activeId = state.phase.activePlayerId;
  const active = state.players.find((p) => p.id === activeId);
  if (active === undefined || active.present) return { state, events: [] };
  if (!hasEligiblePlayer(state)) return { state, events: [] };
  const ended = endActiveTurn(state);
  const settled = advanceUntilPlayerInput(ended.state);
  return { state: settled.state, events: [...ended.events, ...settled.events] };
}
