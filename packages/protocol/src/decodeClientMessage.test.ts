import { describe, expect, it } from "vitest";
import { decodeClientMessage, isValidPlayerName } from "./decodeClientMessage.js";
import { decodeServerMessage } from "./decodeServerMessage.js";

describe("decodeClientMessage", () => {
  it.each([
    [
      '{"t":"create_match","playerName":"Ann"}',
      { t: "create_match", playerName: "Ann", specialty: "survivor" },
    ],
    [
      '{"t":"join_match","matchCode":"ABCD","playerName":"Bo"}',
      { t: "join_match", matchCode: "ABCD", playerName: "Bo", specialty: "survivor" },
    ],
    [
      '{"t":"rejoin_match","matchCode":"ABCD","rejoinToken":"tok"}',
      { t: "rejoin_match", matchCode: "ABCD", rejoinToken: "tok" },
    ],
    ['{"t":"start_match"}', { t: "start_match" }],
    ['{"t":"leave_match"}', { t: "leave_match" }],
    [
      '{"t":"command","commandId":"c3","baseRevision":0,"command":{"type":"move","to":{"x":1,"y":2}}}',
      {
        t: "command",
        commandId: "c3",
        baseRevision: 0,
        command: { type: "move", to: { x: 1, y: 2 } },
      },
    ],
    [
      '{"t":"command","commandId":"c4","baseRevision":7,"command":{"type":"end_turn"}}',
      { t: "command", commandId: "c4", baseRevision: 7, command: { type: "end_turn" } },
    ],
    [
      '{"t":"command","commandId":"c5","baseRevision":7,"command":{"type":"fire_weapon","targetId":"z1"}}',
      {
        t: "command",
        commandId: "c5",
        baseRevision: 7,
        command: { type: "fire_weapon", targetId: "z1" },
      },
    ],
    [
      '{"t":"command","commandId":"c5","baseRevision":7,"command":{"type":"melee_attack","targetId":"z2"}}',
      {
        t: "command",
        commandId: "c5",
        baseRevision: 7,
        command: { type: "melee_attack", targetId: "z2" },
      },
    ],
    [
      '{"t":"create_match","playerName":"Ann","specialty":"paramedic"}',
      { t: "create_match", playerName: "Ann", specialty: "paramedic" },
    ],
    ['{"t":"set_specialty","specialty":"athlete"}', { t: "set_specialty", specialty: "athlete" }],
    ['{"t":"start_match","scenario":"retrieval"}', { t: "start_match", scenario: "retrieval" }],
    ['{"t":"resync"}', { t: "resync" }],
    [
      '{"t":"command","commandId":"c6","baseRevision":7,"command":{"type":"reload"}}',
      { t: "command", commandId: "c6", baseRevision: 7, command: { type: "reload" } },
    ],
    [
      '{"t":"command","commandId":"c7","baseRevision":7,"command":{"type":"pick_up","itemId":"i1"}}',
      {
        t: "command",
        commandId: "c7",
        baseRevision: 7,
        command: { type: "pick_up", itemId: "i1" },
      },
    ],
    [
      '{"t":"command","commandId":"c9","baseRevision":7,"command":{"type":"search","containerId":"c1"}}',
      {
        t: "command",
        commandId: "c9",
        baseRevision: 7,
        command: { type: "search", containerId: "c1" },
      },
    ],
    [
      '{"t":"command","commandId":"c10","baseRevision":7,"command":{"type":"open_door","barrierId":"b1"}}',
      {
        t: "command",
        commandId: "c10",
        baseRevision: 7,
        command: { type: "open_door", barrierId: "b1" },
      },
    ],
    [
      '{"t":"command","commandId":"c11","baseRevision":7,"command":{"type":"close_door","barrierId":"b1"}}',
      {
        t: "command",
        commandId: "c11",
        baseRevision: 7,
        command: { type: "close_door", barrierId: "b1" },
      },
    ],
    [
      '{"t":"command","commandId":"c12","baseRevision":7,"command":{"type":"force_entry","barrierId":"b2"}}',
      {
        t: "command",
        commandId: "c12",
        baseRevision: 7,
        command: { type: "force_entry", barrierId: "b2" },
      },
    ],
    [
      '{"t":"command","commandId":"c8","baseRevision":7,"command":{"type":"use_item","itemType":"medkit"}}',
      {
        t: "command",
        commandId: "c8",
        baseRevision: 7,
        command: { type: "use_item", itemType: "medkit" },
      },
    ],
  ])("accepts %s", (raw, expected) => {
    expect(decodeClientMessage(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    "not json",
    "[]",
    "42",
    '{"t":"teleport"}',
    '{"t":"create_match"}',
    '{"t":"create_match","playerName":"Ann","specialty":"wizard"}',
    '{"t":"set_specialty"}',
    '{"t":"start_match","scenario":"heist"}',
    '{"t":"join_match","matchCode":5,"playerName":"x"}',
    '{"t":"command","commandId":7,"baseRevision":0,"command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"c1"}',
    '{"t":"command","commandId":"c1","command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"c1","baseRevision":"0","command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"c1","baseRevision":-1,"command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"has space","baseRevision":0,"command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"' +
      "x".repeat(65) +
      '","baseRevision":0,"command":{"type":"end_turn"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"fire_weapon"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"fire_weapon","targetId":7}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"use_item"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"use_item","itemType":"rocket"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"pick_up"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"search"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"open_door"}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"force_entry","barrierId":3}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"move","to":{"x":1.5,"y":2}}}',
    '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"move","to":[1,2]}}',
  ])("rejects %s", (raw) => {
    expect(decodeClientMessage(raw).ok).toBe(false);
  });

  it("names the command id when a well-formed envelope carries a bad command", () => {
    const bad = decodeClientMessage(
      '{"t":"command","commandId":"abc","baseRevision":2,"command":{"type":"fire_weapon"}}',
    );
    expect(bad).toMatchObject({ ok: false, commandId: "abc" });
    const noId = decodeClientMessage(
      '{"t":"command","baseRevision":2,"command":{"type":"reload"}}',
    );
    expect(noId.ok).toBe(false);
    expect("commandId" in noId).toBe(false);
  });

  it("drops fields the protocol does not define", () => {
    const result = decodeClientMessage(
      '{"t":"command","commandId":"c1","baseRevision":7,"command":{"type":"move","to":{"x":1,"y":2},"playerId":"p9"}}',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        t: "command",
        commandId: "c1",
        baseRevision: 7,
        command: { type: "move", to: { x: 1, y: 2 } },
      },
    });
  });
});

describe("isValidPlayerName", () => {
  it("accepts ordinary names and rejects empty, long, or control-character names", () => {
    expect(isValidPlayerName("Ann")).toBe(true);
    expect(isValidPlayerName("   ")).toBe(false);
    expect(isValidPlayerName("a".repeat(21))).toBe(false);
    expect(isValidPlayerName(`bad${String.fromCharCode(0)}name`)).toBe(false);
  });
});

describe("decodeServerMessage", () => {
  it("accepts known types and rejects the rest", () => {
    expect(decodeServerMessage('{"t":"error","code":"NOT_HOST","message":"x"}').ok).toBe(true);
    expect(decodeServerMessage('{"t":"nope"}').ok).toBe(false);
    expect(decodeServerMessage("{").ok).toBe(false);
  });
});
