import "server-only";
import {mkdir, readFile, rename, rmdir, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import type {RoverSessionRecord} from "@/lib/rover-session";

export type RoverJobRecord = {
  version: 1; kind: "rover-session-v1"; chainId: number; core: string; jobId: string;
  sessions: RoverSessionRecord[]; requests: Record<string, {hash: string; sessionId: string}>;
};
export type RoverScope = {chainId: number; core: string};

export function assertJobId(jobId: unknown): asserts jobId is string {
  if (typeof jobId !== "string" || !/^[1-9][0-9]{0,77}$/.test(jobId) || BigInt(jobId) >= 2n ** 256n) throw Error("INVALID_JOB_ID");
}

export class RoverSessionStore {
  constructor(readonly root: string, readonly scope: RoverScope) {}
  private path(jobId: string) {
    assertJobId(jobId);
    if (!Number.isSafeInteger(this.scope.chainId) || this.scope.chainId <= 0 || !/^0x[0-9a-f]{40}$/i.test(this.scope.core)) throw Error("INVALID_SESSION_SCOPE");
    return resolve(this.root, `${this.scope.chainId}-${this.scope.core.toLowerCase()}`, `${jobId}.json`);
  }
  async read(jobId: string): Promise<RoverJobRecord | null> {
    try {
      const record = JSON.parse(await readFile(this.path(jobId), "utf8")) as RoverJobRecord;
      if (record.version !== 1 || record.kind !== "rover-session-v1" || record.chainId !== this.scope.chainId
        || record.core !== this.scope.core.toLowerCase() || record.jobId !== jobId
        || !Array.isArray(record.sessions) || !record.requests || typeof record.requests !== "object") throw Error("SESSION_RECORD_INVALID");
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw Error("SESSION_RECORD_INVALID");
    }
  }
  async update<T>(jobId: string, action: (record: RoverJobRecord) => Promise<T>): Promise<T> {
    const path = this.path(jobId);
    await mkdir(resolve(path, ".."), {recursive: true});
    const lock = `${path}.lock`;
    try {await mkdir(lock);} catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw Error("SESSION_BUSY");
      throw error;
    }
    try {
      const record = await this.read(jobId) ?? {version: 1, kind: "rover-session-v1", ...this.scope,
        core: this.scope.core.toLowerCase(), jobId, sessions: [], requests: {}} satisfies RoverJobRecord;
      const result = await action(record);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record), {flag: "wx", mode: 0o600});
      await rename(temporary, path);
      return result;
    } finally {await rmdir(lock);}
  }
}
