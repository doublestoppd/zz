import { describe, expect, it } from "vitest";
import type { UpdateMessage } from "@zombie/protocol";
import { makeClientTestState, P1 } from "../input/testState.js";
import { ClientStore } from "./ClientStore.js";

const full = makeClientTestState();
const { map, ...wire } = full;
const update = (
  revision: number,
  events: UpdateMessage["events"] = [],
  commandId?: string,
): UpdateMessage => ({
  t: "update",
  revision,
  ...(commandId === undefined ? {} : { commandId }),
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

  it("discards updates older than the latest and settles the pending command by id", () => {
    const store = new ClientStore();
    store.applyServerMessage({ t: "map", map });
    store.applyServerMessage(update(3));
    store.markPending("mine");
    store.applyServerMessage(update(2));
    expect(store.get().game?.revision).toBe(3);
    expect(store.get().pendingCommandId).toBe("mine");
    // Someone else's accepted command arrives first: still waiting for ours.
    store.applyServerMessage(update(4, [], "theirs"));
    expect(store.get().pendingCommandId).toBe("mine");
    store.applyServerMessage(update(5, [{ type: "turn_started", playerId: P1, round: 1 }], "mine"));
    expect(store.get().pendingCommandId).toBeUndefined();
    expect(store.get().log).toEqual(["one's turn"]);
    // A server-originated update (no command id) never leaves a command stuck pending.
    store.markPending("next");
    store.applyServerMessage(update(6));
    expect(store.get().pendingCommandId).toBeUndefined();
  });

  it("matches rejections to the pending command id and clears identity on demand", () => {
    const store = new ClientStore();
    store.markPending("b");
    store.applyServerMessage({
      t: "rejected",
      commandId: "a",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
    });
    expect(store.get().pendingCommandId).toBe("b");
    store.applyServerMessage({
      t: "rejected",
      commandId: "b",
      reason: "INVALID_PHASE",
      detail: "NOT_YOUR_TURN",
      currentRevision: 3,
    });
    expect(store.get()).toMatchObject({
      pendingCommandId: undefined,
      lastRejection: { reason: "INVALID_PHASE", detail: "NOT_YOUR_TURN" },
    });
    store.applyServerMessage({ t: "map", map });
    store.clearIdentity();
    expect(store.get().map).toBeUndefined();
  });
});
