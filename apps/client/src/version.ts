/**
 * The client build's human-facing version, injected by the build (`VITE_GAME_VERSION`) and
 * "dev" otherwise. Sent in `hello` for the server's logs; never a compatibility input (the
 * protocol version is).
 */
export const GAME_VERSION: string =
  (import.meta.env.VITE_GAME_VERSION as string | undefined) ?? "dev";
