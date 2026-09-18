/**
 * The human-facing build version, injected at build time (GAME_VERSION) and falling back
 * to a development marker. Protocol and simulation versions live with the code they
 * describe (`@zombie/protocol` and `@zombie/game-core`).
 */
export const GAME_VERSION: string = process.env.GAME_VERSION ?? "0.1.0-dev";
