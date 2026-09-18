import {
  createInitialState,
  matchId,
  playerId,
  type GameEvent,
  type MapLayout,
  type PlayerId,
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
  type ClientCommand,
  type ErrorCode,
  type LobbyMessage,
  type ServerMessage,
} from "@zombie/protocol";
import { sendError } from "../errors.js";
import type { ClientSession } from "../session/ClientSession.js";
import { MatchRuntime } from "./MatchRuntime.js";
import { redactEvents, redactState } from "./redact.js";

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
  /** Highest command `seq` accepted on the current socket; reset when a new socket attaches. */
  lastSeq: number;
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
      lastSeq: 0,
    };
    this.nextPlayerNumber += 1;
    this.members.push(member);
    this.hostId ??= member.playerId;
    this.attach(session, member);
    session.send(this.joinedMessage(member));
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
    session.send(this.joinedMessage(member));
    this.broadcastLobby();
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
    this.broadcastLobby();
    this.broadcast(this.mapMessage());
    this.broadcastUpdate([]);
    return undefined;
  }

  /**
   * Applies one gameplay command. Besides membership, two sequencing guards run before the
   * rules: a `seq` at or below the last accepted one is a duplicate delivery, and an
   * `expectedVersion` other than the current snapshot version means the client composed
   * the command against a board that has since changed. Both are answered with an `error`
   * carrying the `seq`, and neither touches the state.
   */
  handleCommand(
    session: ClientSession,
    message: {
      readonly seq: number;
      readonly expectedVersion: number;
      readonly command: ClientCommand;
    },
  ): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.runtime === undefined) return "MATCH_NOT_STARTED";
    const { seq, expectedVersion, command } = message;
    if (seq <= member.lastSeq) {
      sendError(session, "DUPLICATE_COMMAND", seq);
      return undefined;
    }
    member.lastSeq = seq;
    if (expectedVersion !== this.runtime.getVersion()) {
      sendError(session, "STALE_STATE", seq);
      return undefined;
    }

    // The player id comes from the session, never from the payload.
    const result = this.runtime.apply({ ...command, playerId: member.playerId });
    if (!result.ok) {
      session.send({ t: "rejected", seq, reason: result.reason });
      return undefined;
    }
    this.broadcastUpdate(result.events);
    return undefined;
  }

  private attach(session: ClientSession, member: Member): void {
    member.session = session;
    member.lastSeq = 0;
    session.matchCode = this.code;
    session.playerId = member.playerId;
  }

  private detach(session: ClientSession): void {
    const member = this.members.find((m) => m.session === session);
    if (member !== undefined) member.session = undefined;
    session.matchCode = undefined;
    session.playerId = undefined;
  }

  private joinedMessage(member: Member): ServerMessage {
    return {
      t: "joined",
      protocolVersion: PROTOCOL_VERSION,
      matchCode: this.code,
      playerId: member.playerId,
      rejoinToken: member.rejoinToken,
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
  private updateMessage(events: readonly GameEvent[]): ServerMessage {
    if (this.runtime === undefined) throw new Error("updateMessage: match not started");
    const state = this.runtime.getState();
    return {
      t: "update",
      version: this.runtime.getVersion(),
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

  private broadcastUpdate(events: readonly GameEvent[], except?: ClientSession): void {
    this.broadcast(this.updateMessage(events), except);
  }
}
