import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkInvariants,
  createRng,
  fingerprint,
  type Command,
  type GameMap,
  type GameState,
  type MatchJournal,
  type PlayerState,
  type Rng,
} from "@zombie/game-core";
import type {
  ClientCommand,
  RejectedMessage,
  ServerMessage,
  UpdateMessage,
} from "@zombie/protocol";
import { DEFAULT_MATCH_DEPENDENCIES, MatchRegistry } from "../lobby/MatchRegistry.js";
import { startSocketServer, type SocketServerHandle } from "../net/socketServer.js";
import { handleClientMessage, handleDisconnect } from "../router.js";
import { ProtocolClient } from "../testing/protocolClient.js";
import { decide } from "./botPolicy.js";

/**
 * Soak: deterministic bots play whole matches against the real server over real sockets,
 * checking invariants on every snapshot and recording anything that goes wrong as a
 * replayable journal. Match seeds drive the city and the simulation; a bot seed derived
 * from the match seed drives the chaos (disconnects, duplicate and stale probes), so a
 * failure is reproducible by seed alone.
 */
export interface SoakOptions {
  /** How many matches to play. */
  readonly matches: number;
  /** Seed of the first match; the next matches use seed + 1, + 2, ... */
  readonly seedStart: number;
  /** Fixed party size, or cycle 1..4 when omitted. */
  readonly players?: number;
  /** Disconnect/rejoin and protocol probes during play. */
  readonly chaos: boolean;
  /** A match still running after this round is a failure (a stuck game). */
  readonly maxRounds: number;
  /** Where failing seeds and their journals are written; nothing is written when unset. */
  readonly failuresDir?: string;
  /** Extra checks run on every snapshot every bot receives; each returned string fails the match. */
  readonly invariants?: (state: GameState) => readonly string[];
  /** Per-message wait before a match counts as stalled. */
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

export type SoakOutcome = "victory" | "defeat" | "failure";

export interface SoakMatchResult {
  readonly seed: number;
  readonly players: number;
  readonly outcome: SoakOutcome;
  readonly rounds: number;
  readonly revisions: number;
  readonly commands: number;
  /** Rule rejections the bots answered by ending their turn (hidden zombies, mostly). */
  readonly rejections: number;
  readonly reconnects: number;
  readonly probes: number;
  /** Own commands the server called stale because a teammate's presence changed first. */
  readonly staleRetries: number;
  readonly failure?: SoakFailure;
}

export interface SoakFailure {
  readonly reason:
    | "INVARIANT"
    | "CLIENT_VIEW_MISMATCH"
    | "REVISION_NOT_MONOTONIC"
    | "UNEXPECTED_REJECTION"
    | "PROBE_MISCLASSIFIED"
    | "REJOIN_FAILED"
    | "SERVER_ERROR"
    | "TIMEOUT"
    | "STALL";
  readonly detail: string;
  readonly player?: string;
  readonly revision?: number;
  /** Where the journal was written, when `failuresDir` is set. */
  readonly journalFile?: string;
}

export interface SoakReport {
  readonly results: readonly SoakMatchResult[];
  readonly failures: readonly SoakMatchResult[];
  readonly durationMs: number;
}

class SoakError extends Error {
  constructor(
    readonly failure: Omit<SoakFailure, "journalFile">,
    message = failure.detail,
  ) {
    super(message);
  }
}

/**
 * Checks every bot runs on every snapshot it receives: game-core's full invariant set on
 * the team view, plus what only a client can see (below, `checkInvariants` in the bot).
 */
export function baseInvariants(state: GameState): string[] {
  return checkInvariants(state, "full").map((v) => `${v.code}: ${v.detail}`);
}

interface MatchShared {
  readonly seed: number;
  readonly rng: Rng;
  /** Fingerprint of the snapshot at each revision, as first seen by any bot. */
  readonly views: Map<number, string>;
  commands: number;
  rejections: number;
  reconnects: number;
  probes: number;
  staleRetries: number;
  rounds: number;
  revisions: number;
  finished: boolean;
}

export async function runSoak(options: SoakOptions): Promise<SoakReport> {
  const started = Date.now();
  const log = options.log ?? (() => undefined);
  let currentSeed = options.seedStart;
  const { onJournal: _onJournal, ...production } = DEFAULT_MATCH_DEPENDENCIES;
  const registry = new MatchRegistry({
    deps: {
      ...production,
      createSeed: () => currentSeed,
      createRejoinToken: () => randomBytes(16).toString("hex"),
    },
  });
  const handle: SocketServerHandle = await startSocketServer({
    port: 0,
    onMessage: (session, message) => {
      handleClientMessage(registry, session, message);
    },
    onDisconnect: (session) => {
      handleDisconnect(registry, session);
    },
    // Bots send as fast as the server answers; the production limit is for humans.
    rateLimit: { burst: 10_000, perSecond: 10_000 },
  });
  const results: SoakMatchResult[] = [];
  try {
    for (let i = 0; i < options.matches; i += 1) {
      currentSeed = options.seedStart + i;
      const players = options.players ?? (i % 4) + 1;
      const result = await playMatch(handle.port, registry, currentSeed, players, options);
      results.push(result);
      log(
        `seed ${result.seed} ${result.players}p ${result.outcome} rounds=${result.rounds} revisions=${result.revisions}` +
          (result.failure === undefined
            ? ""
            : ` ${result.failure.reason}: ${result.failure.detail}`),
      );
    }
  } finally {
    await handle.close();
  }
  return {
    results,
    failures: results.filter((r) => r.outcome === "failure"),
    durationMs: Date.now() - started,
  };
}

async function playMatch(
  port: number,
  registry: MatchRegistry,
  seed: number,
  players: number,
  options: SoakOptions,
): Promise<SoakMatchResult> {
  const shared: MatchShared = {
    seed,
    rng: createRng(seed ^ 0x5eed),
    views: new Map(),
    commands: 0,
    rejections: 0,
    reconnects: 0,
    probes: 0,
    staleRetries: 0,
    rounds: 0,
    revisions: 0,
    finished: false,
  };
  const bots: Bot[] = [];
  let code = "";
  let failure: Omit<SoakFailure, "journalFile"> | undefined;
  let outcome: SoakOutcome;
  try {
    for (let i = 0; i < players; i += 1) {
      const bot = await Bot.join(port, i === 0 ? undefined : code, `Bot${i + 1}`, options, shared);
      if (i === 0) code = bot.code;
      bots.push(bot);
    }
    await Promise.all(bots.map((b) => b.awaitLobby(players)));
    bots[0]?.client.send({ t: "start_match" });
    const finals = await Promise.all(bots.map((b) => b.play()));
    const final = finals[0];
    if (final === undefined) throw new Error("no bots");
    outcome = final.phase.kind === "finished" ? final.phase.outcome : "failure";
    if (options.chaos) await bots[shared.rng.int(0, bots.length - 1)]?.checkTerminalRejoin();
  } catch (error) {
    failure =
      error instanceof SoakError ? error.failure : { reason: "STALL", detail: String(error) };
    outcome = "failure";
  } finally {
    await Promise.all(bots.map((b) => b.client.close()));
  }
  let journalFile: string | undefined;
  if (failure !== undefined && options.failuresDir !== undefined) {
    journalFile = persistFailure(options.failuresDir, registry, code, seed, players, failure);
  }
  return {
    seed,
    players,
    outcome,
    rounds: shared.rounds,
    revisions: shared.revisions,
    commands: shared.commands,
    rejections: shared.rejections,
    reconnects: shared.reconnects,
    probes: shared.probes,
    staleRetries: shared.staleRetries,
    ...(failure === undefined
      ? {}
      : { failure: journalFile === undefined ? failure : { ...failure, journalFile } }),
  };
}

/**
 * Writes `<seed>-<players>p.journal.json` (a bare journal the replay CLI accepts) and
 * `<seed>-<players>p.failure.json` (what went wrong and how to rerun it).
 */
function persistFailure(
  dir: string,
  registry: MatchRegistry,
  code: string,
  seed: number,
  players: number,
  failure: Omit<SoakFailure, "journalFile">,
): string | undefined {
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${seed}-${players}p`);
  const journal: MatchJournal | undefined = registry.get(code)?.journal();
  const journalFile = journal === undefined ? undefined : `${base}.journal.json`;
  if (journal !== undefined && journalFile !== undefined) {
    writeFileSync(journalFile, JSON.stringify(journal));
  }
  writeFileSync(
    `${base}.failure.json`,
    JSON.stringify(
      {
        seed,
        players,
        ...failure,
        journalFile,
        rerun: `pnpm --filter @zombie/server soak -- --seed ${seed} --matches 1 --players ${players} --chaos`,
      },
      null,
      2,
    ),
  );
  return journalFile;
}

/** One bot: a protocol client plus the game view it rebuilds from `map` and `update`. */
class Bot {
  private map: GameMap | undefined;
  private state: GameState | undefined;
  private lastRevision = -1;
  private lastAccepted: { commandId: string; command: ClientCommand } | undefined;
  private awaitingCommandId: string | undefined;
  private awaitingCommand: ClientCommand | undefined;
  private probe: { commandId: string; expect: RejectedMessage["reason"] } | undefined;

  private constructor(
    public client: ProtocolClient,
    private readonly port: number,
    readonly code: string,
    readonly playerId: string,
    private readonly token: string,
    private readonly options: SoakOptions,
    private readonly shared: MatchShared,
  ) {}

  static async join(
    port: number,
    code: string | undefined,
    name: string,
    options: SoakOptions,
    shared: MatchShared,
  ): Promise<Bot> {
    const client = await ProtocolClient.connect(port, { timeoutMs: options.timeoutMs ?? 5000 });
    client.send(
      code === undefined
        ? { t: "create_match", playerName: name }
        : { t: "join_match", matchCode: code, playerName: name },
    );
    const joined = await client.next("joined");
    return new Bot(
      client,
      port,
      joined.matchCode,
      joined.playerId,
      joined.rejoinToken,
      options,
      shared,
    );
  }

  async awaitLobby(players: number): Promise<void> {
    await this.client.next("lobby", (m) => m.players.length === players);
  }

  private fail(failure: Omit<SoakFailure, "journalFile" | "player" | "revision">): never {
    throw new SoakError({ ...failure, player: this.playerId, revision: this.lastRevision });
  }

  /** Plays until the match finishes and returns the final state as this bot saw it. */
  async play(): Promise<GameState> {
    for (;;) {
      const message = await this.client.nextAny();
      const done = await this.handle(message);
      if (done !== undefined) return done;
    }
  }

  private async handle(message: ServerMessage): Promise<GameState | undefined> {
    switch (message.t) {
      case "map":
        this.map = message.map;
        return undefined;
      case "lobby":
      case "joined":
      case "welcome":
        return undefined;
      case "error":
        return this.fail({ reason: "SERVER_ERROR", detail: `${message.code}: ${message.message}` });
      case "rejected":
        this.onRejected(message);
        return undefined;
      case "update":
        return this.onUpdate(message);
    }
  }

  private onRejected(message: RejectedMessage): void {
    if (message.commandId === this.probe?.commandId) {
      const expected = this.probe.expect;
      this.probe = undefined;
      if (message.reason !== expected) {
        this.fail({
          reason: "PROBE_MISCLASSIFIED",
          detail: `expected ${expected}, got ${message.reason} (${message.detail ?? ""})`,
        });
      }
      if (expected === "STALE_REVISION" && message.currentRevision !== this.lastRevision) {
        this.fail({
          reason: "PROBE_MISCLASSIFIED",
          detail: `stale probe reported revision ${String(message.currentRevision)}, bot at ${this.lastRevision}`,
        });
      }
      return;
    }
    if (message.commandId !== this.awaitingCommandId) {
      this.fail({
        reason: "UNEXPECTED_REJECTION",
        detail: `rejection for unknown command ${message.commandId}: ${message.reason}`,
      });
    }
    const command = this.awaitingCommand;
    this.awaitingCommandId = undefined;
    this.awaitingCommand = undefined;
    if (message.reason === "STALE_REVISION") {
      // Someone's presence changed between our snapshot and our command (chaos). The
      // newer snapshot has already arrived on this socket; act on it as a client would
      // after a resync.
      this.shared.staleRetries += 1;
      if (message.currentRevision !== this.lastRevision) {
        this.fail({
          reason: "PROBE_MISCLASSIFIED",
          detail: `stale rejection names revision ${String(message.currentRevision)}, bot has ${this.lastRevision}`,
        });
      }
      const state = this.state;
      if (state?.phase.kind === "player_turn" && state.phase.activePlayerId === this.playerId) {
        const me = state.players.find((p) => p.id === this.playerId);
        if (me !== undefined) this.sendCommand(strip(decide(state, me)));
      }
      return;
    }
    if (message.reason === "INVALID_ACTION" && command?.type !== "end_turn") {
      // The bot planned from a fog-of-war view; a hidden zombie can void a move. Same
      // fallback as the in-process playtest: give up the turn.
      this.shared.rejections += 1;
      this.sendCommand({ type: "end_turn" });
      return;
    }
    this.fail({
      reason: "UNEXPECTED_REJECTION",
      detail: `${command?.type ?? "?"} rejected: ${message.reason} ${message.detail ?? ""}`,
    });
  }

  private async onUpdate(message: UpdateMessage): Promise<GameState | undefined> {
    if (this.map === undefined) this.fail({ reason: "SERVER_ERROR", detail: "update before map" });
    if (message.revision <= this.lastRevision) {
      this.fail({
        reason: "REVISION_NOT_MONOTONIC",
        detail: `revision ${message.revision} after ${this.lastRevision}`,
      });
    }
    const state: GameState = { ...message.state, map: this.map };
    this.lastRevision = message.revision;
    this.state = state;
    this.shared.rounds = Math.max(this.shared.rounds, state.round);
    this.shared.revisions = Math.max(this.shared.revisions, message.revision);
    if (
      message.commandId !== undefined &&
      message.commandId === this.awaitingCommandId &&
      this.awaitingCommand !== undefined
    ) {
      this.lastAccepted = { commandId: message.commandId, command: this.awaitingCommand };
      this.awaitingCommandId = undefined;
      this.awaitingCommand = undefined;
      this.shared.commands += 1;
    }
    this.checkInvariants(state, message.revision);
    if (state.phase.kind === "finished") return state;
    if (state.round > this.options.maxRounds) {
      this.fail({ reason: "TIMEOUT", detail: `round ${state.round} > ${this.options.maxRounds}` });
    }
    if (this.awaitingCommandId !== undefined) return undefined; // our command is still in flight
    const me = state.players.find((p) => p.id === this.playerId);
    if (me === undefined) this.fail({ reason: "INVARIANT", detail: "own player missing" });
    if (this.options.chaos) {
      const chaos = await this.maybeChaos(state, me);
      if (chaos !== undefined) return chaos.final;
    }
    if (state.phase.kind === "player_turn" && state.phase.activePlayerId === this.playerId) {
      this.sendCommand(strip(decide(state, me)));
    }
    return undefined;
  }

  private checkInvariants(state: GameState, revision: number): void {
    const problems = [...baseInvariants(state), ...(this.options.invariants?.(state) ?? [])];
    if (problems.length > 0) {
      this.fail({ reason: "INVARIANT", detail: problems.join("; ") });
    }
    // Every bot must see the same team view at the same revision.
    const view = fingerprint(strippedForView(state));
    const seen = this.shared.views.get(revision);
    if (seen === undefined) this.shared.views.set(revision, view);
    else if (seen !== view) {
      this.fail({ reason: "CLIENT_VIEW_MISMATCH", detail: `revision ${revision}` });
    }
  }

  private sendCommand(command: ClientCommand): void {
    this.awaitingCommandId = this.client.command(command, { baseRevision: this.lastRevision });
    this.awaitingCommand = command;
  }

  /**
   * Undefined when the bot should act on this update as usual. Otherwise the chaos action
   * replaced the action; `final` is set when the snapshot seen after a rejoin ended the match.
   */
  private async maybeChaos(
    state: GameState,
    me: PlayerState,
  ): Promise<{ final?: GameState } | undefined> {
    const active = state.phase.kind === "player_turn" && state.phase.activePlayerId === me.id;
    const roll = this.shared.rng.next();
    if (active && roll < 0.08 && this.lastAccepted !== undefined) {
      // Retransmit an already accepted command: must be classified as a duplicate.
      this.shared.probes += 1;
      this.probe = { commandId: this.lastAccepted.commandId, expect: "DUPLICATE_COMMAND" };
      this.client.command(this.lastAccepted.command, {
        commandId: this.lastAccepted.commandId,
        baseRevision: this.lastRevision,
      });
      return undefined;
    }
    if (active && roll < 0.16 && this.lastRevision > 0) {
      // A command composed against an older revision: must be classified as stale.
      this.shared.probes += 1;
      const commandId = this.client.command(
        { type: "end_turn" },
        { baseRevision: this.lastRevision - 1 },
      );
      this.probe = { commandId, expect: "STALE_REVISION" };
      return undefined;
    }
    if (roll > 0.98 || (active && roll > 0.95)) {
      const final = await this.reconnect();
      return final === undefined ? {} : { final };
    }
    return undefined;
  }

  /** Drops the socket without a handshake and rejoins with the token, like a refreshed tab. */
  private async reconnect(): Promise<GameState | undefined> {
    this.shared.reconnects += 1;
    await this.client.terminate();
    this.client = await ProtocolClient.connect(this.port, {
      timeoutMs: this.options.timeoutMs ?? 5000,
    });
    this.client.send({ t: "rejoin_match", matchCode: this.code, rejoinToken: this.token });
    const answer = await this.client.nextAny();
    if (answer.t !== "joined" || !answer.rejoined || !answer.matchStarted) {
      this.fail({ reason: "REJOIN_FAILED", detail: JSON.stringify(answer) });
    }
    if (answer.playerId !== this.playerId) {
      this.fail({ reason: "REJOIN_FAILED", detail: `rejoined as ${answer.playerId}` });
    }
    this.map = (await this.client.next("map")).map;
    // The snapshot that follows is at least as new as the last one we saw.
    const snapshot = await this.client.next("update");
    if (snapshot.revision < this.lastRevision) {
      this.fail({
        reason: "REVISION_NOT_MONOTONIC",
        detail: `rejoin snapshot ${snapshot.revision} after ${this.lastRevision}`,
      });
    }
    // Equal is legitimate: the new socket can arrive before the server notices the old one
    // went, so no presence change (and no revision) happened in between.
    this.lastRevision = snapshot.revision - 1;
    const me = snapshot.state.players.find((p) => p.id === this.playerId);
    if (me?.present !== true) {
      this.fail({ reason: "REJOIN_FAILED", detail: "not present after rejoin" });
    }
    this.awaitingCommandId = undefined;
    this.awaitingCommand = undefined;
    this.probe = undefined;
    // Process the snapshot like any update (it may be our turn again, or the match may
    // have ended while we were away).
    return this.onUpdate(snapshot);
  }

  /** After the match ends: a rejoin still works and gameplay commands are refused. */
  async checkTerminalRejoin(): Promise<void> {
    await this.client.terminate();
    this.client = await ProtocolClient.connect(this.port, {
      timeoutMs: this.options.timeoutMs ?? 5000,
    });
    this.client.send({ t: "rejoin_match", matchCode: this.code, rejoinToken: this.token });
    const joined = await this.client.next("joined");
    if (!joined.rejoined) this.fail({ reason: "REJOIN_FAILED", detail: "terminal rejoin refused" });
    await this.client.next("map");
    const snapshot = await this.client.next("update");
    if (snapshot.state.phase.kind !== "finished") {
      this.fail({ reason: "INVARIANT", detail: "terminal rejoin snapshot is not finished" });
    }
    const commandId = this.client.command(
      { type: "end_turn" },
      { baseRevision: snapshot.revision },
    );
    const rejected = await this.client.next("rejected", (m) => m.commandId === commandId);
    if (rejected.reason !== "INVALID_PHASE" || rejected.detail !== "MATCH_FINISHED") {
      this.fail({
        reason: "PROBE_MISCLASSIFIED",
        detail: `command after finish: ${rejected.reason} ${rejected.detail ?? ""}`,
      });
    }
  }
}

/** The wire command for a policy decision: the server attaches the player id itself. */
function strip(command: Command): ClientCommand {
  const { playerId: _playerId, ...rest } = command;
  return rest as ClientCommand;
}

/** The part of a snapshot every bot must agree on (everything the server sent). */
function strippedForView(state: GameState): unknown {
  const { map: _map, ...rest } = state;
  return rest;
}
