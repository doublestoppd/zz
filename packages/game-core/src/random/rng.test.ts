import { describe, expect, it } from "vitest";
import { createRng, deriveSeed } from "./rng.js";

describe("createRng", () => {
  it("produces the same sequence for the same state", () => {
    const a = createRng(123);
    const b = createRng(123);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("continues the sequence when rebuilt from getState()", () => {
    const original = createRng(7);
    original.next();
    const resumed = createRng(original.getState());
    expect(resumed.next()).toBe(original.next());
  });

  it("returns integers within the inclusive range", () => {
    const rng = createRng(99);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("picks only from the list and throws on an empty one", () => {
    const rng = createRng(1);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 50; i += 1) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });
});

describe("deriveSeed", () => {
  it("gives different streams different seeds and is deterministic", () => {
    expect(deriveSeed(42, 0)).toBe(deriveSeed(42, 0));
    expect(deriveSeed(42, 0)).not.toBe(deriveSeed(42, 1));
    expect(deriveSeed(42, 0)).not.toBe(deriveSeed(43, 0));
  });
});
