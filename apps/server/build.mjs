// Bundles the server with esbuild and writes dist/build-info.json next to it. The build
// version and source revision come from the environment (CI sets them; a local build gets
// "0.1.0-dev" and the working tree's commit) and are baked into the bundle so a deployed
// artifact identifies itself without any runtime configuration.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const sourceRevision =
  process.env.SOURCE_REVISION ??
  (() => {
    try {
      return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "unknown";
    }
  })();
const gameVersion = process.env.GAME_VERSION ?? `${pkg.version}-dev`;

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ["bufferutil", "utf-8-validate"],
  outfile: "dist/server.js",
  define: {
    __BUILD_GAME_VERSION__: JSON.stringify(gameVersion),
    __BUILD_SOURCE_REVISION__: JSON.stringify(sourceRevision),
  },
  logLevel: "info",
});

// The protocol and simulation versions are read from the sources the bundle was built
// from, so the file can never disagree with the code it sits next to.
const versionOf = (file, name) => {
  const match = new RegExp(`${name} = (\\d+);`).exec(
    readFileSync(new URL(file, import.meta.url), "utf8"),
  );
  if (match === null) throw new Error(`${name} not found in ${file}`);
  return Number(match[1]);
};
const PROTOCOL_VERSION = versionOf("../../packages/protocol/src/messages.ts", "PROTOCOL_VERSION");
const SIMULATION_VERSION = versionOf(
  "../../packages/game-core/src/version.ts",
  "SIMULATION_VERSION",
);
mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/build-info.json",
  JSON.stringify(
    {
      artifact: "server",
      gameVersion,
      protocolVersion: PROTOCOL_VERSION,
      simulationVersion: SIMULATION_VERSION,
      sourceRevision,
      builtAt: new Date().toISOString(),
      node: process.version,
    },
    null,
    2,
  ),
);
