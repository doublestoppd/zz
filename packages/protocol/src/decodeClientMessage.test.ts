import { describe, expect, it } from "vitest";
import { decodeClientMessage, isValidPlayerName } from "./decodeClientMessage.js";
import { decodeServerMessage } from "./decodeServerMessage.js";

describe("decodeClientMessage", () => {
  it.each([
    ['{"t":"create_match","playerName":"Ann"}', { t: "create_match", playerName: "Ann" }],
    [
      '{"t":"join_match","matchCode":"ABCD","playerName":"Bo"}',
      { t: "join_match", matchCode: "ABCD", playerName: "Bo" },
    ],
    [
      '{"t":"rejoin_match","matchCode":"ABCD","rejoinToken":"tok"}',
      { t: "rejoin_match", matchCode: "ABCD", rejoinToken: "tok" },
    ],
    ['{"t":"start_match"}', { t: "start_match" }],
    ['{"t":"leave_match"}', { t: "leave_match" }],
    [
      '{"t":"command","seq":3,"command":{"type":"move","to":{"x":1,"y":2}}}',
      { t: "command", seq: 3, command: { type: "move", to: { x: 1, y: 2 } } },
    ],
    [
      '{"t":"command","seq":4,"command":{"type":"end_turn"}}',
      { t: "command", seq: 4, command: { type: "end_turn" } },
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
    '{"t":"join_match","matchCode":5,"playerName":"x"}',
    '{"t":"command","seq":"1","command":{"type":"end_turn"}}',
    '{"t":"command","seq":1}',
    '{"t":"command","seq":1,"command":{"type":"fire_weapon"}}',
    '{"t":"command","seq":1,"command":{"type":"move","to":{"x":1.5,"y":2}}}',
    '{"t":"command","seq":1,"command":{"type":"move","to":[1,2]}}',
  ])("rejects %s", (raw) => {
    expect(decodeClientMessage(raw).ok).toBe(false);
  });

  it("drops fields the protocol does not define", () => {
    const result = decodeClientMessage(
      '{"t":"command","seq":1,"command":{"type":"move","to":{"x":1,"y":2},"playerId":"p9"}}',
    );
    expect(result).toEqual({
      ok: true,
      value: { t: "command", seq: 1, command: { type: "move", to: { x: 1, y: 2 } } },
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
