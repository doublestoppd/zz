/**
 * Branded identifier types.
 *
 * All IDs are strings on the wire and in JSON, but the brand stops a PlayerId from being
 * passed where a ZombieId is expected. Construct them only through the factory functions
 * below so every cast is in one place.
 */
export type PlayerId = string & { readonly __brand: "PlayerId" };
export type ZombieId = string & { readonly __brand: "ZombieId" };
export type MatchId = string & { readonly __brand: "MatchId" };

export function playerId(raw: string): PlayerId {
  return raw as PlayerId;
}

export function zombieId(raw: string): ZombieId {
  return raw as ZombieId;
}

export function matchId(raw: string): MatchId {
  return raw as MatchId;
}
