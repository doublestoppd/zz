import { runSmoke } from "./runSmoke.js";

/**
 * `pnpm --filter @zombie/server smoke -- --url wss://staging.example`: the deployment
 * smoke test. Exit 0 when every step passed, 1 otherwise. Prints one line per step.
 */
const index = process.argv.indexOf("--url");
const url = index === -1 ? process.env.SMOKE_URL : process.argv[index + 1];
if (url === undefined || url === "") {
  process.stderr.write("usage: smoke --url ws://host:port (or SMOKE_URL)\n");
  process.exit(2);
}
const result = await runSmoke({
  url,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
