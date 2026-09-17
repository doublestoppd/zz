import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";
import { pickWeighted } from "./weighted.js";

describe("pickWeighted", () => {
  it("respects weights over many rolls and is deterministic", () => {
    const table = [
      { type: "a", weight: 1 },
      { type: "b", weight: 3 },
    ];
    const counts = { a: 0, b: 0 };
    const rng = createRng(9);
    for (let i = 0; i < 4000; i += 1) counts[pickWeighted(table, rng) as "a" | "b"] += 1;
    expect(counts.b / counts.a).toBeGreaterThan(2.5);
    expect(counts.b / counts.a).toBeLessThan(3.5);
    expect(pickWeighted(table, createRng(5))).toBe(pickWeighted(table, createRng(5)));
  });

  it("always returns the only entry and throws on an empty table", () => {
    expect(pickWeighted([{ type: "x", weight: 1 }], createRng(1))).toBe("x");
    expect(() => pickWeighted([], createRng(1))).toThrow();
  });
});
