import { describe, expect, it } from "vitest";
import type { UpdateMessage } from "@zombie/protocol";
import { makeClientTestState, P1 } from "../input/testState.js";
import { ClientStore } from "./ClientStore.js";

const full = makeClientTestState();
const { map, ...wire } = full;
const update = (version: number, events: UpdateMessage["events"] = []): UpdateMessage => ({
  t: "update",
  version,
  state: wire,
  events,
});

describe("ClientStore", () => {
  it("joins update snapshots to the map received once", () => {
    const store = new ClientStore();
    store.applyServerMessage(update(0));
    expect(store.get().game).toBeUndefined(); // no map yet: ignored
    store.applyServerMessage({ t: "map", map });
    store.applyServerMessage(update(0));
    expect(store.get().game?.state).toEqual(full);
  });

  it("discards updates older than the latest and clears the pending command", () => {
    const store = new ClientStore();
    store.applyServerMessage({ t: "map", map });
    store.applyServerMessage(update(3));
    store.markPending(7);
    store.applyServerMessage(update(2));
    expect(store.get().game?.version).toBe(3);
    expect(store.get().pendingSeq).toBe(7);
    store.applyServerMessage(update(4, [{ type: "turn_started", playerId: P1, round: 1 }]));
    expect(store.get().pendingSeq).toBeUndefined();
    expect(store.get().log).toEqual(["one's turn"]);
  });

  it("matches rejections to the pending seq and clears identity on demand", () => {
    const store = new ClientStore();
    store.markPending(2);
    store.applyServerMessage({ t: "rejected", seq: 1, reason: "NOT_YOUR_TURN" });
    expect(store.get().pendingSeq).toBe(2);
    store.applyServerMessage({ t: "rejected", seq: 2, reason: "NOT_YOUR_TURN" });
    expect(store.get()).toMatchObject({ pendingSeq: undefined, lastRejection: "NOT_YOUR_TURN" });
    store.applyServerMessage({ t: "map", map });
    store.clearIdentity();
    expect(store.get().map).toBeUndefined();
  });
});
