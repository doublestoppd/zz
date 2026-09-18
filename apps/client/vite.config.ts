import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
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

/** Writes dist/build-info.json after the bundle so the artifact identifies itself. */
function buildInfo(): Plugin {
  return {
    name: "build-info",
    closeBundle() {
      // Read from the sources the bundle was built from (the packages are TypeScript, not
      // importable here), so the file cannot disagree with the code.
      const versionOf = (file: string, name: string): number => {
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        const match = new RegExp(`${name} = (\\d+);`).exec(source);
        if (match === null) throw new Error(`${name} not found in ${file}`);
        return Number(match[1]);
      };
      const PROTOCOL_VERSION = versionOf(
        "../../packages/protocol/src/messages.ts",
        "PROTOCOL_VERSION",
      );
      const SIMULATION_VERSION = versionOf(
        "../../packages/game-core/src/version.ts",
        "SIMULATION_VERSION",
      );
      mkdirSync("dist", { recursive: true });
      writeFileSync(
        "dist/build-info.json",
        JSON.stringify(
          {
            artifact: "client",
            gameVersion,
            protocolVersion: PROTOCOL_VERSION,
            simulationVersion: SIMULATION_VERSION,
            sourceRevision,
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    },
  };
}

export default defineConfig({
  server: { port: 5173 },
  define: {
    "import.meta.env.VITE_GAME_VERSION": JSON.stringify(
      process.env.VITE_GAME_VERSION ?? gameVersion,
    ),
    "import.meta.env.VITE_SOURCE_REVISION": JSON.stringify(sourceRevision),
  },
  plugins: [buildInfo()],
  test: {
    // Pure helpers only; Phaser scenes are covered by typecheck, not tests.
    include: ["src/**/*.test.ts"],
  },
});
