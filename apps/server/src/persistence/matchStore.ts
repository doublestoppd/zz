import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchJournal, PlayerId, SpecialtyType } from "@zombie/game-core";

/** The lifecycle of a match as the server sees it (docs/ARCHITECTURE.md, "Match lifecycle"). */
export type MatchStatus = "lobby" | "starting" | "active" | "completed" | "abandoned";

/**
 * What must survive a process restart to bring a match back: who is in it (with the
 * credential that lets them return) and the journal, from which the state is rebuilt by
 * replay. Nothing about sockets, presence, or presentation is stored.
 */
export interface MatchRecord {
  readonly code: string;
  readonly status: MatchStatus;
  readonly hostId: PlayerId | undefined;
  readonly members: readonly {
    readonly playerId: PlayerId;
    readonly name: string;
    readonly specialty: SpecialtyType;
    /** A credential: the store must be private to the server. Never logged. */
    readonly rejoinToken: string;
  }[];
  readonly journal: MatchJournal;
  /** Wall-clock time of the save, used only for retention sweeps, never by the simulation. */
  readonly savedAt: number;
}

/** The one persistence seam. Two implementations: files for deployments, memory for tests. */
export interface MatchStore {
  save(record: MatchRecord): void;
  delete(code: string): void;
  list(): MatchRecord[];
}

export class MemoryMatchStore implements MatchStore {
  private readonly records = new Map<string, MatchRecord>();

  save(record: MatchRecord): void {
    this.records.set(record.code, record);
  }

  delete(code: string): void {
    this.records.delete(code);
  }

  list(): MatchRecord[] {
    return [...this.records.values()];
  }
}

/**
 * One JSON file per match under `dir`, written whole on every save. Matches change at
 * human speed and a record is tens to hundreds of kilobytes, so the simplest durable
 * mechanism is enough; there is no database to operate.
 */
export class FileMatchStore implements MatchStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(record: MatchRecord): void {
    const file = this.fileFor(record.code);
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(record));
    // Rename is atomic on POSIX, so a crash mid-write never leaves a torn record.
    renameSync(temp, file);
  }

  delete(code: string): void {
    rmSync(this.fileFor(code), { force: true });
  }

  list(): MatchRecord[] {
    const records: MatchRecord[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        records.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as MatchRecord);
      } catch {
        // An unreadable record is reported by the caller's log; it is never silently used.
        records.push({
          code: name.replace(/\.json$/, ""),
          status: "abandoned",
          hostId: undefined,
          members: [],
          journal: undefined as never,
          savedAt: 0,
        });
      }
    }
    return records;
  }

  private fileFor(code: string): string {
    if (!/^[A-Z0-9]{1,16}$/.test(code)) throw new Error(`matchStore: bad code ${code}`);
    return join(this.dir, `${code}.json`);
  }
}
