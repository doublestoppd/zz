import type { Identity } from "../state/ClientStore.js";

const KEY = "zombie.identity";

/** Remembers the match code and rejoin token across reloads of this tab. */
export function saveIdentity(identity: Identity): void {
  sessionStorage.setItem(KEY, JSON.stringify(identity));
}

export function loadIdentity(): Identity | undefined {
  const raw = sessionStorage.getItem(KEY);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return undefined;
  }
}

export function clearIdentity(): void {
  sessionStorage.removeItem(KEY);
}
