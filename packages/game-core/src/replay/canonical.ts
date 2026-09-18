import { hashString } from "../random/hash.js";

/**
 * JSON with object keys in sorted order at every level, so two structurally equal states
 * serialise to the same text whatever order their keys were created in. Only plain data
 * is expected (GameState is plain data by contract).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/** A short, stable fingerprint of a canonical value: FNV-1a over its canonical JSON, as hex. */
export function fingerprint(value: unknown): string {
  return hashString(canonicalJson(value)).toString(16).padStart(8, "0");
}
