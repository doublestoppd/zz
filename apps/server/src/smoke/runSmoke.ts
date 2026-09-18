import { PROTOCOL_VERSION } from "@zombie/protocol";
import { ProtocolClient } from "../testing/protocolClient.js";

/**
 * A deployment smoke test against a live server (staging or production): two real
 * clients handshake, create and join a lobby, start a match, play one command, and one
 * of them reconnects with its token. It exercises the version handshake, the lobby, the
 * simulation, persistence of identity, and the reconnect path end to end, in a few
 * seconds, without touching any other match on the server. Every step reports; the first
 * failure ends the run (docs/OPERATIONS.md, "Deployment").
 */
export interface SmokeOptions {
  /** `ws://host:port` or `wss://host`. */
  readonly url: string;
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly steps: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly detail?: string;
  }[];
  readonly server?: { readonly gameVersion: string; readonly simulationVersion: number };
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const steps: { name: string; ok: boolean; detail?: string }[] = [];
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? 5000;
  let server: SmokeResult["server"];
  const clients: ProtocolClient[] = [];
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    try {
      const value = await work();
      steps.push({ name, ok: true });
      log(`ok   ${name}`);
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ name, ok: false, detail });
      log(`FAIL ${name}: ${detail}`);
      throw error;
    }
  };
  try {
    const host = await step("handshake", async () => {
      const raw = await ProtocolClient.connect(options.url, { timeoutMs, handshake: false });
      clients.push(raw);
      raw.send({ t: "hello", protocolVersion: PROTOCOL_VERSION, gameVersion: "smoke" });
      const welcome = await raw.next("welcome");
      server = { gameVersion: welcome.gameVersion, simulationVersion: welcome.simulationVersion };
      log(
        `     server ${welcome.gameVersion} (protocol ${welcome.protocolVersion}, simulation ${welcome.simulationVersion})`,
      );
      return raw;
    });
    const joined = await step("create lobby", async () => {
      host.send({ t: "create_match", playerName: "Smoke host" });
      return host.next("joined");
    });
    const guest = await step("join lobby", async () => {
      const g = await ProtocolClient.connect(options.url, { timeoutMs });
      clients.push(g);
      g.send({ t: "join_match", matchCode: joined.matchCode, playerName: "Smoke guest" });
      await g.next("joined");
      await host.next("lobby", (m) => m.players.length === 2);
      return g;
    });
    await step("start match", async () => {
      host.send({ t: "start_match" });
      await Promise.all([host.next("map"), guest.next("map")]);
      const [a, b] = await Promise.all([host.next("update"), guest.next("update")]);
      if (a.revision !== b.revision)
        throw new Error(`revisions differ: ${a.revision} vs ${b.revision}`);
    });
    await step("accepted command", async () => {
      const id = host.command({ type: "end_turn" }, { baseRevision: 0 });
      const [a, b] = await Promise.all([
        host.next("update", (m) => m.commandId === id),
        guest.next("update", (m) => m.commandId === id),
      ]);
      if (a.revision !== 1 || b.revision !== 1) throw new Error("revision did not advance to 1");
    });
    await step("reconnect with token", async () => {
      await guest.terminate();
      const back = await ProtocolClient.connect(options.url, { timeoutMs });
      clients.push(back);
      back.send({ t: "rejoin_match", matchCode: joined.matchCode, rejoinToken: guestToken(guest) });
      const again = await back.next("joined");
      if (!again.rejoined || !again.matchStarted) throw new Error("rejoin refused");
      await back.next("map");
      const snapshot = await back.next("update");
      if (snapshot.revision < 1) throw new Error(`stale snapshot ${snapshot.revision}`);
    });
    return { ok: true, steps, ...(server === undefined ? {} : { server }) };
  } catch {
    return { ok: false, steps, ...(server === undefined ? {} : { server }) };
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
}

/** The guest's token was delivered in its `joined`; the client remembers it. */
function guestToken(guest: ProtocolClient): string {
  const token = guest.identity?.rejoinToken;
  if (token === undefined) throw new Error("guest has no rejoin token");
  return token;
}
