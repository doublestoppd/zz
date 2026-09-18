/**
 * One-line JSON logs so a log collector can index them; `pnpm dev` prints the same lines.
 * Keep fields plain data; never log tokens or full player payloads. `LOG_LEVEL` (debug,
 * info, warn, error; default info) drops anything below it. Fields worth using everywhere:
 * `matchCode`, `playerId`, `sessionId`, `commandId`, `revision`, `round`, `phase`.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error" ? raw : "info";
}

let threshold: LogLevel = configuredLevel();

/** Tests and the entry point may change the threshold; production reads `LOG_LEVEL` once. */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
