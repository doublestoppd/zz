import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SMALL_TEST_MAP } from "@zombie/game-core";
import { MatchRegistry } from "../lobby/MatchRegistry.js";
import { ServerMatch, type MatchDependencies } from "../match/ServerMatch.js";
import { verifyJournal } from "../replay/verifier.js";
import type { ClientSession } from "../session/ClientSession.js";
import {
  FileMatchStore,
  MemoryMatchStore,
  type MatchRecord,
  type MatchStore,
} from "./matchStore.js";

interface FakeSession extends ClientSession {
  readonly sent: unknown[];
  readonly closedWith: string[];
}

function fakeSession(id: string): FakeSession {
  const sent: unknown[] = [];
  const closedWith: string[] = [];
  return {
    id,
    sent,
    closedWith,
    matchCode: undefined,
    playerId: undefined,
    send(message) {
      sent.push(message);
    },
    close(reason = "replaced") {
      closedWith.push(reason);
    },
  };
}

/** A scheduler that never fires; tests that need the timer capture it explicitly. */
const NEVER = { schedule: () => ({ cancel: () => undefined }) };

function deps(store: MatchStore): MatchDependencies {
  let tokens = 0;
  return {
    createSeed: () => 21,
    createRejoinToken: () => `token-${(tokens += 1)}`,
    createLayout: () => ({
      layout: SMALL_TEST_MAP,
      source: { kind: "fixture", name: "SMALL_TEST_MAP" },
    }),
    store,
  };
}

/** A two-player match with a few accepted mutations, checkpointed into `store`. */
function playInto(store: MatchStore): { code: string; hostToken: string; revision: number } {
  const match = new ServerMatch("PERS", deps(store));
  const a = fakeSession("a");
  const b = fakeSession("b");
  match.join(a, "Ann");
  match.join(b, "Bo");
  match.start(a);
  let n = 0;
  const cmd = (
    s: ClientSession,
    command: { type: "move"; to: { x: number; y: number } } | { type: "end_turn" },
  ) => {
    n += 1;
    const revision = match.journal()?.entries.length ?? 0;
    match.handleCommand(s, { commandId: `p${n}`, baseRevision: revision, command } as never);
  };
  cmd(a, { type: "move", to: { x: 2, y: 1 } });
  cmd(a, { type: "end_turn" });
  cmd(b, { type: "move", to: { x: 2, y: 2 } });
  const joined = a.sent.find((m) => (m as { t: string }).t === "joined") as { rejoinToken: string };
  return {
    code: match.code,
    hostToken: joined.rejoinToken,
    revision: match.journal()!.entries.length,
  };
}

describe("match store", () => {
  it("writes one atomic file per match and lists it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "zombie-state-"));
    const store = new FileMatchStore(dir);
    const { code, revision } = playInto(store);
    expect(readdirSync(dir)).toEqual([`${code}.json`]);
    const [record] = store.list();
    expect(record).toMatchObject({ code, status: "active" });
    expect(record?.journal.entries).toHaveLength(revision);
    expect(record?.members.map((m) => m.name)).toEqual(["Ann", "Bo"]);
    store.delete(code);
    expect(existsSync(join(dir, `${code}.json`))).toBe(false);
    expect(store.list()).toEqual([]);
  });
});

describe("restart recovery", () => {
  it("restores an active match at its revision with journal continuity and lets players rejoin", () => {
    const store = new MemoryMatchStore();
    const { code, hostToken, revision } = playInto(store);

    // A new process: nothing in memory, only the store.
    const registry = new MatchRegistry({
      store,
      deps: deps(store),
      scheduler: NEVER,
    });
    expect(registry.restore()).toEqual({ restored: 1, discarded: 0 });
    const match = registry.get(code);
    if (match === undefined) throw new Error("not restored");
    expect(match.getStatus()).toBe("active");
    expect(match.isStarted()).toBe(true);
    expect(match.hasNoPresentMembers()).toBe(true);
    // Members who were present when the process died are now absent in the state (journaled).
    const journal = match.journal()!;
    expect(journal.entries.length).toBeGreaterThanOrEqual(revision);
    expect(
      journal.entries.slice(revision).every((e) => e.command.type === "set_player_presence"),
    ).toBe(true);

    const back = fakeSession("back");
    expect(match.rejoin(back, hostToken)).toBeUndefined();
    const update = back.sent.find((m) => (m as { t: string }).t === "update") as {
      revision: number;
      state: { players: { present: boolean; position: { x: number } }[] };
    };
    expect(update.revision).toBe(match.journal()!.entries.length);
    expect(update.state.players[0]?.position).toEqual({ x: 2, y: 1 }); // the move survived the restart
    expect(update.state.players[0]?.present).toBe(true);

    // The journal keeps growing from where it stopped and still replays as a whole.
    match.handleCommand(back, {
      commandId: "after-restart",
      baseRevision: update.revision,
      command: { type: "end_turn" },
    } as never);
    const after = match.journal()!;
    expect(after.entries.at(-1)?.revision).toBe(update.revision + 1);
    expect(verifyJournal(after)).toMatchObject({ ok: true, entries: after.entries.length });
  });

  it("drops lobbies, expired completed records, and records that do not replay", () => {
    const store = new MemoryMatchStore();
    const { code } = playInto(store);
    const [active] = store.list();
    const stale: MatchRecord = { ...active!, code: "OLDC", status: "completed", savedAt: 0 };
    const fresh: MatchRecord = {
      ...active!,
      code: "NEWC",
      status: "completed",
      savedAt: Date.now(),
    };
    const corrupt: MatchRecord = {
      ...active!,
      code: "CRPT",
      journal: {
        ...active!.journal,
        entries: active!.journal.entries.map((e, i) => (i === 0 ? { ...e, checkpoint: "bad" } : e)),
      },
    };
    store.save(stale);
    store.save(fresh);
    store.save(corrupt);
    const registry = new MatchRegistry({
      store,
      deps: deps(store),
      scheduler: NEVER,
    });
    expect(registry.restore()).toEqual({ restored: 1, discarded: 2 });
    expect(registry.get(code)).toBeDefined();
    expect(
      store
        .list()
        .map((r) => r.code)
        .sort(),
    ).toEqual(["NEWC", code].sort());
  });

  it("marks a match abandoned after the grace period and forgets its record", () => {
    const store = new MemoryMatchStore();
    const { code } = playInto(store);
    const fires: (() => void)[] = [];
    const registry = new MatchRegistry({
      store,
      deps: deps(store),
      scheduler: {
        schedule: (cb) => {
          fires.push(cb);
          return { cancel: () => undefined };
        },
      },
    });
    registry.restore();
    expect(fires).toHaveLength(1);
    fires[0]!();
    expect(registry.get(code)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });
});

describe("graceful shutdown", () => {
  it("refuses new lobbies, tells players the server is going away, and keeps the records", () => {
    const store = new MemoryMatchStore();
    const registry = new MatchRegistry({
      store,
      deps: deps(store),
      scheduler: NEVER,
    });
    const match = registry.create()!;
    const a = fakeSession("a");
    match.join(a, "Ann");
    match.start(a);
    const drained = registry.shutdown();
    expect(drained).toEqual({ active: 1, lobbies: 0 });
    expect(a.sent.at(-1)).toMatchObject({ t: "error", code: "SHUTTING_DOWN" });
    expect(a.closedWith).toEqual(["going_away"]);
    expect(registry.create()).toBeUndefined();
    expect(registry.isDraining()).toBe(true);
    expect(store.list().map((r) => r.status)).toEqual(["active"]);
  });
});
