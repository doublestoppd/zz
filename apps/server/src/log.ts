/**
 * One-line JSON logs so a log collector can index them; `pnpm dev` prints the same lines.
 * Keep fields plain data; never log tokens or full player payloads.
 */
export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
