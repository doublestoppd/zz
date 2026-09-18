/**
 * The human-facing build version and the source revision. Both are baked into the bundle
 * by `build.mjs` (from `GAME_VERSION` and `SOURCE_REVISION` at build time) and may still be
 * overridden by the same variables at start; a development run without either reports a
 * `-dev` label. Protocol and simulation versions live with the code they describe
 * (`@zombie/protocol` and `@zombie/game-core`).
 */
declare const __BUILD_GAME_VERSION__: string | undefined;
declare const __BUILD_SOURCE_REVISION__: string | undefined;

const bakedGameVersion =
  typeof __BUILD_GAME_VERSION__ === "string" ? __BUILD_GAME_VERSION__ : undefined;
const bakedRevision =
  typeof __BUILD_SOURCE_REVISION__ === "string" ? __BUILD_SOURCE_REVISION__ : undefined;

export const GAME_VERSION: string = process.env.GAME_VERSION ?? bakedGameVersion ?? "0.1.0-dev";
export const SOURCE_REVISION: string = process.env.SOURCE_REVISION ?? bakedRevision ?? "unknown";
