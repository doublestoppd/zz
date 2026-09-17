import {
  createInitialState,
  matchId,
  playerId,
  SMALL_TEST_MAP,
  type GameEvent,
  type PlayerId,
} from "@zombie/game-core";
import { DEFAULT_GAME_RULES, DEFAULT_SURVIVOR } from "@zombie/game-data";
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  isValidPlayerName,
  type ClientCommand,
  type ErrorCode,
  type LobbyMessage,
  type ServerMessage,
} from "@zombie/protocol";
import type { ClientSession } from "../session/ClientSession.js";
import { MatchRuntime } from "./MatchRuntime.js";

/** Sources of non-determinism, injected so tests can pin them. */
export interface MatchDependencies {
  readonly createSeed: () => number;
  readonly createRejoinToken: () => string;
}

interface Member {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly rejoinToken: string;
  /** Undefined while the player is disconnected. */
  session: ClientSession | undefined;
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

  join(session: ClientSession, rawName: string): ErrorCode | undefined {
    if (session.matchCode !== undefined) return "ALREADY_IN_MATCH";
    if (this.isStarted()) return "MATCH_ALREADY_STARTED";
    if (this.members.length >= MAX_PLAYERS) return "MATCH_FULL";
    if (!isValidPlayerName(rawName)) return "INVALID_PLAYER_NAME";

    const member: Member = {
      playerId: playerId(`${this.code}-p${this.nextPlayerNumber}`),
      name: rawName.trim(),
      rejoinToken: this.deps.createRejoinToken(),
      session,
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

    // A stale socket for the same slot is superseded by the new one.
    if (member.session !== undefined) this.detach(member.session);
    this.attach(session, member);
    session.send(this.joinedMessage(member));
    this.broadcastLobby();
    if (this.runtime !== undefined) {
      const presence = this.runtime.apply({
        type: "set_player_presence",
        playerId: member.playerId,
        present: true,
      });
      session.send(this.updateMessage(presence.ok ? presence.events : []));
      if (presence.ok && presence.events.length > 0) this.broadcastUpdate(presence.events, session);
    }
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

  start(session: ClientSession): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.isStarted()) return "MATCH_ALREADY_STARTED";
    if (member.playerId !== this.hostId) return "NOT_HOST";

    const initial = createInitialState({
      matchId: matchId(this.code),
      seed: this.deps.createSeed(),
      rules: DEFAULT_GAME_RULES,
      survivor: DEFAULT_SURVIVOR,
      layout: SMALL_TEST_MAP,
      players: this.members.map((m) => ({ id: m.playerId, name: m.name })),
    });
    this.runtime = new MatchRuntime(initial);
    this.broadcastLobby();
    this.broadcastUpdate([]);
    return undefined;
  }

  handleCommand(
    session: ClientSession,
    seq: number,
    command: ClientCommand,
  ): ErrorCode | undefined {
    const member = this.members.find((m) => m.session === session);
    if (member === undefined) return "NOT_IN_MATCH";
    if (this.runtime === undefined) return "MATCH_NOT_STARTED";

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
        present: m.session !== undefined,
      })),
    };
  }

  private updateMessage(events: readonly GameEvent[]): ServerMessage {
    if (this.runtime === undefined) throw new Error("updateMessage: match not started");
    return {
      t: "update",
      version: this.runtime.getVersion(),
      state: this.runtime.getState(),
      events,
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
