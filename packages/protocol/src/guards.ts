/** Small runtime type guards shared by the decoders. Kept dependency-free on purpose. */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}
