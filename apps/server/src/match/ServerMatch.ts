import {
  createInitialState,
  matchId,
  playerId,
  type GameEvent,
  type MapLayout,
  type PlayerId,
  type RejectionReason,
  type ScenarioType,
  type SpecialtyType,
} from "@zombie/game-core";
import {
  DEFAULT_GAME_RULES,
  DEFAULT_SURVIVOR,
  LOOT_TABLE,
  SCENARIOS,
  ZOMBIE_SPAWN_TABLE,
} from "@zombie/game-data";
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  isValidPlayerName,
  type CommandMessage,
  type CommandRejectionReason,
  type ErrorCode,
  type LobbyMessage,
  type ServerMessage,
} from "@zombie/protocol";
import { sendError } from "../errors.js";
import { log } from "../log.js";
import type { ClientSession } from "../session/ClientSession.js";
import { MatchRuntime } from "./MatchRuntime.js";
import { redactEvents, redactState } from "./redact.js";

/** Running totals of the events that describe how a match was played. */
class MatchStats {
  private readonly counts: Record<string, number> = {};
  private readonly downs: { readonly round: number; readonly playerId: PlayerId }[] = [];

  /** Event types whose counts describe the match's economy. */
  private static readonly COUNTED: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
    "weapon_fired",
    "weapon_swung",
    "weapon_reloaded",
    "item_used",
    "container_searched",
    "barrier_forced",
    "door_opened",
    "entity_died",
    "zombie_attacked",
    "dynamic_event",
  ]);

  record(events: readonly GameEvent[], round: number): void {
    for (const event of events) {
      if (event.type === "player_downed") {
        this.downs.push({ round, playerId: event.playerId });
      } else if (MatchStats.COUNTED.has(event.type)) {
        this.counts[event.type] = (this.counts[event.type] ?? 0) + 1;
      }
    }
  }

  summary(): Record<string, unknown> {
    return { ...this.counts, downs: this.downs };
  }
}

/** Sources of non-determinism and the map source, injected so tests can pin them. */
export interface MatchDependencies {
  readonly createSeed: () => number;
  readonly createRejoinToken: () => string;
  /** Builds the board for a match. Production generates a city from the seed. */
  readonly createLayout: (seed: number, playerCount: number) => MapLayout;
}

interface Member {
  readonly playerId: PlayerId;
  readonly name: string;
  specialty: SpecialtyType;
  readonly rejoinToken: string;
  /** Undefined while the player is disconnected. */
  session: ClientSession | undefined;
  /** Ids of recent commands, kept with the player (not the socket) so a retransmission after a reconnect is still a duplicate. */
  readonly recentCommands: RecentCommandIds;
}

/** A bounded first-in, first-out memory of command ids. */
export class RecentCommandIds {
  private readonly order: string[] = [];
  private readonly known = new Set<string>();

  constructor(private readonly capacity = 256) {}

  has(id: string): boolean {
    return this.known.has(id);
  }

  add(id: string): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.order.push(id);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.known.delete(oldest);
    }
  }
}

/** Game-core reasons that are about who may act now rather than about the action itself. */
const PHASE_REASONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "MATCH_FINISHED",
  "WRONG_PHASE",
  "NOT_YOUR_TURN",
  "PLAYER_NOT_ACTIVE",
]);

/** Maps a game-core reason onto the protocol's closed set of command rejection categories. */
export function categorize(reason: RejectionReason): CommandRejectionReason {
  if (reason === "UNKNOWN_PLAYER") return "NOT_AUTHORIZED";
  return PHASE_REASONS.has(reason) ? "INVALID_PHASE" : "INVALID_ACTION";
}

/**
 * A lobby that becomes a running match. Owns membership, host, and the MatchRuntime,
 * and is the only place that broadcasts. Every method that can fail returns an
 * ErrorCode instead of throwing so the router can answer the sender.
 */
export class ServerMatch {
  readonly code: string;
  private hostId: PlayerId | undefined;
  private readonly members: Member[] = [];
  private runtime: MatchRuntime | undefined;
  private nextPlayerNumber = 1;
  private readonly stats = new MatchStats();
  private endLogged = false;

  constructor(
    code: string,
    private readonly deps: MatchDependencies,
  ) {
    this.code = code;
  }

  isStarted(): boolean {
    return this.runtime !== undefined;
  }

  /** True when no member is connected. The registry uses this to discard matches. */
  hasNoPresentMembers(): boolean {
    return this.members.every((m) => m.session === undefined);
  }

  memberCount(): number {
    return this.members.length;
  }

  join(
    session: ClientSession,
    rawName: string,
    specialty: SpecialtyType = "survivor",
  ): ErrorCode | undefined {
    if (session.matchCode !== undefined) return "ALREADY_IN_MATCH";
    if (this.isStarted()) return "MATCH_ALREADY_STARTED";
    if (this.members.length >= MAX_PLAYERS) return "MATCH_FULL";
    if (!isValidPlayerName(rawName)) return "INVALID_PLAYER_NAME";

    const member: Member = {
      playerId: playerId(`${this.code}-p${this.nextPlayerNumber}`),
      name: rawName.trim(),
      specialty,
      rejoinToken: this.deps.createRejoinToken(),
      session,
      recentCommands: new RecentCommandIds(),
    };
    this.nextPlayerNumber += 1;
    this.members.push(member);
    this.hostId ??= member.playerId;
    this.attach(session, member);
    session.send(this.joinedMessage(member, false));
    this.broadcastLobby();
    return undefined;
  }

  rejoin(session: ClientSession, rejoinToken: string): ErrorCode | undefined {
    if (session.matchCode !== undefined) return "ALREADY_IN_MATCH";
    const member = this.members.find((m) => m.rejoinToken === rejoinToken);
    if (member === undefined) return "INVALID_REJOIN_TOKEN";

    // A stale socket for the same slot is superseded by the new one and told so.
    if (member.session !== undefined) {
      const replaced = member.session;
      sendError(replaced, "SESSION_REPLACED");
      this.detach(replaced);
      replaced.close();
    }
    this.attach(session, member);
    session.send(this.joinedMessage(member, true));
    this.broadcastLobby();
    log("info", "player rejoined", {
      matchCode: this.code,
      playerId: member.playerId,
      started: this.isStarted(),
    });
    if (this.runtime !== undefined) {
      const presence = this.runtime.apply({
        type: "set_player_presence",
        playerId: member.playerId,
        present: true,
      });
      session.send(this.mapMessage());
      session.send(this.updateMessage(presence.ok ? presence.events : []));
      if (presence.ok && presence.events.length > 0) this.broadcastUpdate(presence.events, session);
    }
    return undefined;
  }

  /** Specialties are fixed once the match starts; the lobby list tells everyone the choice. */
  setSpecialty(session: ClientSession, specialty: SpecialtyType): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.isStarted()) return "MATCH_ALREADY_STARTED";
    member.specialty = specialty;
    this.broadcastLobby();
    return undefined;
  }

  /** Voluntary leave and socket loss are handled the same way. */
  handleDisconnect(session: ClientSession): void {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return;
    this.detach(session);

    if (this.runtime === undefined) {
      // Lobby: the slot is released and host passes to the next member.
      this.members.splice(this.members.indexOf(member), 1);
      if (this.hostId === member.playerId) this.hostId = this.members[0]?.playerId;
      this.broadcastLobby();
      return;
    }
    // Running match: the slot stays so the player can rejoin; the turn order skips them.
    this.broadcastLobby();
    const presence = this.runtime.apply({
      type: "set_player_presence",
      playerId: member.playerId,
      present: false,
    });
    if (presence.ok) this.broadcastUpdate(presence.events);
  }

  start(session: ClientSession, scenario: ScenarioType = "extraction"): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.isStarted()) return "MATCH_ALREADY_STARTED";
    if (member.playerId !== this.hostId) return "NOT_HOST";

    const seed = this.deps.createSeed();
    const initial = createInitialState({
      matchId: matchId(this.code),
      seed,
      rules: DEFAULT_GAME_RULES,
      survivor: DEFAULT_SURVIVOR,
      scenario: SCENARIOS[scenario],
      lootTable: LOOT_TABLE,
      zombieSpawnTable: ZOMBIE_SPAWN_TABLE,
      layout: this.deps.createLayout(seed, this.members.length),
      players: this.members.map((m) => ({ id: m.playerId, name: m.name, specialty: m.specialty })),
    });
    this.runtime = new MatchRuntime(initial);
    log("info", "match started", {
      matchCode: this.code,
      seed,
      scenario,
      playerCount: this.members.length,
      specialties: this.members.map((m) => m.specialty),
    });
    this.broadcastLobby();
    this.broadcast(this.mapMessage());
    this.broadcastUpdate([]);
    return undefined;
  }

  /**
   * Applies one gameplay command through the documented pipeline: membership, match
   * started, duplicate id, base revision, then the rules. Every outcome is answered: an
   * `update` carrying the command id to everyone, or a typed `rejected` to the sender.
   * Nothing but an accepted command touches the state.
   */
  handleCommand(session: ClientSession, message: CommandMessage): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    const { commandId, baseRevision, command } = message;
    const reject = (
      reason: CommandRejectionReason,
      detail?: RejectionReason,
    ): ErrorCode | undefined => {
      const currentRevision = this.runtime?.getRevision();
      session.send({
        t: "rejected",
        commandId,
        reason,
        ...(detail === undefined ? {} : { detail }),
        ...(currentRevision === undefined ? {} : { currentRevision }),
      });
      log("info", "command rejected", {
        matchCode: this.code,
        playerId: member.playerId,
        commandId,
        type: command.type,
        reason,
        detail: detail ?? null,
        revision: currentRevision ?? null,
      });
      return undefined;
    };
    if (this.runtime === undefined) return reject("MATCH_NOT_STARTED");
    if (member.recentCommands.has(commandId)) return reject("DUPLICATE_COMMAND");
    if (baseRevision !== this.runtime.getRevision()) return reject("STALE_REVISION");

    // The player id comes from the session, never from the payload.
    const result = this.runtime.apply({ ...command, playerId: member.playerId });
    member.recentCommands.add(commandId);
    if (!result.ok) return reject(categorize(result.reason), result.reason);
    log("info", "command accepted", {
      matchCode: this.code,
      playerId: member.playerId,
      commandId,
      type: command.type,
      revision: this.runtime.getRevision(),
      round: result.state.round,
      phase: result.state.phase.kind,
    });
    this.broadcastUpdate(result.events, undefined, commandId);
    return undefined;
  }

  /** Sends this socket the board and the latest snapshot again (the client fell out of sync). */
  resync(session: ClientSession): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.runtime === undefined) return "MATCH_NOT_STARTED";
    session.send(this.mapMessage());
    session.send(this.updateMessage([]));
    return undefined;
  }

  private attach(session: ClientSession, member: Member): void {
    member.session = session;
    session.matchCode = this.code;
    session.playerId = member.playerId;
  }

  private detach(session: ClientSession): void {
    const member = this.members.find((m) => m.session === session);
    if (member !== undefined) member.session = undefined;
    session.matchCode = undefined;
    session.playerId = undefined;
  }

  private joinedMessage(member: Member, rejoined: boolean): ServerMessage {
    return {
      t: "joined",
      protocolVersion: PROTOCOL_VERSION,
      matchCode: this.code,
      playerId: member.playerId,
      rejoinToken: member.rejoinToken,
      rejoined,
      matchStarted: this.isStarted(),
    };
  }

  private lobbyMessage(): LobbyMessage {
    return {
      t: "lobby",
      matchCode: this.code,
      hostId: this.hostId ?? playerId(""),
      maxPlayers: MAX_PLAYERS,
      started: this.isStarted(),
      players: this.members.map((m) => ({
        id: m.playerId,
        name: m.name,
        specialty: m.specialty,
        present: m.session !== undefined,
      })),
    };
  }

  private mapMessage(): ServerMessage {
    if (this.runtime === undefined) throw new Error("mapMessage: match not started");
    return { t: "map", map: this.runtime.getState().map };
  }

  /**
   * The snapshot without its map (every socket received it once in `mapMessage`) and
   * without anything the team cannot currently see (`redact.ts`).
   */
  private updateMessage(events: readonly GameEvent[], commandId?: string): ServerMessage {
    if (this.runtime === undefined) throw new Error("updateMessage: match not started");
    const state = this.runtime.getState();
    return {
      t: "update",
      revision: this.runtime.getRevision(),
      ...(commandId === undefined ? {} : { commandId }),
      state: redactState(state),
      events: redactEvents(events, state),
    };
  }

  private broadcast(message: ServerMessage, except?: ClientSession): void {
    for (const member of this.members) {
      if (member.session !== undefined && member.session !== except) member.session.send(message);
    }
  }

  private broadcastLobby(): void {
    this.broadcast(this.lobbyMessage());
  }

  private broadcastUpdate(
    events: readonly GameEvent[],
    except?: ClientSession,
    commandId?: string,
  ): void {
    this.recordForPlaytest(events);
    this.broadcast(this.updateMessage(events, commandId), except);
  }

  /**
   * Alpha instrumentation: counts the events that describe a match's economy and, once
   * the match is over, writes one structured log line with the seed, configuration,
   * outcome, and totals (docs/BALANCE.md explains the fields). No analytics service.
   */
  private recordForPlaytest(events: readonly GameEvent[]): void {
    if (this.runtime === undefined) return;
    const state = this.runtime.getState();
    this.stats.record(events, state.round);
    if (state.phase.kind !== "finished" || this.endLogged) return;
    this.endLogged = true;
    log("info", "match ended", {
      matchCode: this.code,
      seed: state.seed,
      scenario: state.objective.scenario,
      playerCount: state.players.length,
      specialties: state.players.map((p) => p.specialty),
      outcome: state.phase.outcome,
      rounds: state.round,
      threat: state.threat,
      heat: state.heat,
      zombiesSpawned: state.zombieCounter,
      zombiesLeft: state.zombies.length,
      ...this.stats.summary(),
    });
  }
}
