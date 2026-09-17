import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_RULES, DEFAULT_SURVIVOR } from "./index.js";

describe("game data", () => {
  it("defines positive, integer survivor statistics", () => {
    expect(Number.isInteger(DEFAULT_SURVIVOR.maxHealth)).toBe(true);
    expect(DEFAULT_SURVIVOR.maxHealth).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_SURVIVOR.maxActionPoints)).toBe(true);
    expect(DEFAULT_SURVIVOR.maxActionPoints).toBeGreaterThan(0);
  });

  it("charges at least one action point per tile", () => {
    expect(DEFAULT_GAME_RULES.moveCostPerTile).toBeGreaterThanOrEqual(1);
  });
});
