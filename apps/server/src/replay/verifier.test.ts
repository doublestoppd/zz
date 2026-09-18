import { describe, expect, it } from "vitest";
import { SIMULATION_VERSION, SMALL_TEST_MAP, type MatchJournal } from "@zombie/game-core";
import { ServerMatch } from "../match/ServerMatch.js";
import type { ClientSession } from "../session/ClientSession.js";
import { verifyJournal } from "./verifier.js";

/** An in-process session that records what the server sends it. */
function fakeSession(id: string): ClientSession & { readonly sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    id,
    sent,
    address: "test",
    matchCode: undefined,
    playerId: undefined,
    send(message) {
      sent.push(message);
    },
    close() {
      sent.push({ closed: true });
    },
  };
}

function playedMatch(layoutSeed: number): { match: ServerMatch; journal: MatchJournal } {
  const match = new ServerMatch("JRNL", {
    createSeed: () => layoutSeed,
    createRejoinToken: () => "secret-token",
    createLayout: () => ({
      layout: SMALL_TEST_MAP,
      source: { kind: "fixture", name: "SMALL_TEST_MAP" },
    }),
  });
  const a = fakeSession("a");
  const b = fakeSession("b");
  expect(match.join(a, "Ann", "athlete")).toBeUndefined();
  expect(match.join(b, "Bo")).toBeUndefined();
  expect(match.start(a)).toBeUndefined();
  let n = 0;
  const cmd = (
    session: ClientSession,
    command: Parameters<ServerMatch["handleCommand"]>[1]["command"],
  ) => {
    n += 1;
    const revision = match.journal()?.entries.at(-1)?.revision ?? 0;
    match.handleCommand(session, { commandId: `j${n}`, baseRevision: revision, command } as never);
  };
  cmd(a, { type: "move", to: { x: 2, y: 1 } });
  cmd(a, { type: "end_turn" });
  match.handleDisconnect(b); // presence mutations are journaled too
  cmd(a, { type: "move", to: { x: 3, y: 1 } });
  cmd(a, { type: "end_turn" });
  const journal = match.journal();
  if (journal === undefined) throw new Error("no journal");
  return { match, journal };
}

describe("journal verifier", () => {
  it("records every accepted mutation with its revision and replays it exactly", () => {
    const { journal } = playedMatch(11);
    expect(journal.metadata).toMatchObject({
      seed: 11,
      simulationVersion: SIMULATION_VERSION,
      scenario: "extraction",
      layout: { kind: "fixture", name: "SMALL_TEST_MAP" },
      players: [
        { name: "Ann", specialty: "athlete" },
        { name: "Bo", specialty: "survivor" },
      ],
    });
    expect(journal.entries.map((e) => e.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(journal.entries.map((e) => e.command.type)).toEqual([
      "move",
      "end_turn",
      "set_player_presence",
      "move",
      "end_turn",
    ]);
    expect(JSON.stringify(journal)).not.toContain("secret-token");
    const verdict = verifyJournal(journal);
    expect(verdict).toMatchObject({ ok: true, entries: 5 });
    expect(verifyJournal(JSON.parse(JSON.stringify(journal)) as MatchJournal)).toEqual(verdict);
  });

  it("refuses another simulation version and reports the first diverging revision", () => {
    const { journal } = playedMatch(5);
    const old = { ...journal, metadata: { ...journal.metadata, simulationVersion: 0 } };
    expect(verifyJournal(old)).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_SIMULATION_VERSION",
      recorded: 0,
    });
    const tampered: MatchJournal = {
      ...journal,
      entries: journal.entries.map((e, i) => (i === 3 ? { ...e, checkpoint: "deadbeef" } : e)),
    };
    expect(verifyJournal(tampered)).toMatchObject({
      ok: false,
      reason: "CHECKPOINT_MISMATCH",
      revision: 4,
    });
  });
});
