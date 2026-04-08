import type { Database } from "sqlite";
import type { ToolConfig, RunEntry } from "./types";
import type { SDK } from "caido:plugin";
import type { API, Events } from "./index";
import { DEFAULT_PRESETS } from "./presets";

type PluginSDK = SDK<API, Events>;

let dbPromise: Promise<Database> | null = null;
let sdkRef: PluginSDK | undefined;

export function setSdkRef(sdk: PluginSDK): void {
  sdkRef = sdk;
}

function log(msg: string): void {
  sdkRef?.console?.log(`[Dispatch] ${msg}`);
}

function logError(msg: string): void {
  sdkRef?.console?.error(`[Dispatch] ${msg}`);
}

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    if (!sdkRef) throw new Error("SDK not set");
    dbPromise = initDatabase();
  }
  return dbPromise;
}

// SQL escape for string values (single-quote escaping for SQLite)
function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

// --- Query abstraction ---
// Caido's sdk.meta.db() may expose different APIs across versions.
// We probe once at init and cache the working method.

type QueryFn = (db: Database, sql: string) => Promise<Record<string, unknown>[]>;

let queryFn: QueryFn | null = null;

async function probeQueryMethod(db: Database): Promise<QueryFn> {
  const testSql = "SELECT 1 as _probe";
  const dbAny = db as unknown as Record<string, unknown>;

  // Method 1: prepare().all() — standard sqlite API
  if (typeof dbAny.prepare === "function") {
    try {
      const prepareFn = dbAny.prepare as (sql: string) => unknown;
      const stmt = prepareFn.call(db, testSql);
      const resolved = (stmt && typeof (stmt as Promise<unknown>).then === "function")
        ? await (stmt as Promise<unknown>)
        : stmt;
      const resolvedObj = resolved as Record<string, unknown>;
      if (resolvedObj && typeof resolvedObj.all === "function") {
        const allFn = resolvedObj.all as () => unknown;
        const rows = await allFn.call(resolved);
        if (Array.isArray(rows)) {
          log("Using query method: prepare().all()");
          return async (d: Database, sql: string) => {
            const dAny = d as unknown as Record<string, unknown>;
            const s = (dAny.prepare as (sql: string) => unknown).call(d, sql);
            const r = (s && typeof (s as Promise<unknown>).then === "function") ? await s : s;
            const rObj = r as Record<string, unknown>;
            return (rObj && typeof rObj.all === "function")
              ? await (rObj.all as () => Promise<Record<string, unknown>[]>).call(r)
              : [];
          };
        }
      }
    } catch (e) {
      log(`prepare().all() probe failed: ${e}`);
    }
  }

  // Method 2: db.exec() — fallback
  if (typeof dbAny.exec === "function") {
    try {
      const execFn = dbAny.exec as (sql: string) => unknown;
      const result = await execFn.call(db, testSql);
      if (Array.isArray(result)) {
        log("Using query method: db.exec() (array)");
        return async (d: Database, sql: string) => {
          const dAny = d as unknown as Record<string, unknown>;
          const r = await (dAny.exec as (sql: string) => Promise<unknown>).call(d, sql);
          return Array.isArray(r) ? r as Record<string, unknown>[] : [];
        };
      }
      if (result && typeof result === "object") {
        const resultObj = result as Record<string, unknown>;
        if (Array.isArray(resultObj.rows)) {
          log("Using query method: db.exec() (rows)");
          return async (d: Database, sql: string) => {
            const dAny = d as unknown as Record<string, unknown>;
            const r = await (dAny.exec as (sql: string) => Promise<unknown>).call(d, sql) as Record<string, unknown>;
            return Array.isArray(r?.rows) ? r.rows as Record<string, unknown>[] : [];
          };
        }
        if (Array.isArray(resultObj.values) && Array.isArray(resultObj.columns)) {
          log("Using query method: db.exec() (columns+values)");
          return async (d: Database, sql: string) => {
            const dAny = d as unknown as Record<string, unknown>;
            const r = await (dAny.exec as (sql: string) => Promise<unknown>).call(d, sql) as Record<string, unknown>;
            if (!Array.isArray(r?.values) || !Array.isArray(r?.columns)) return [];
            const cols = r.columns as string[];
            return (r.values as unknown[][]).map((row) => {
              const obj: Record<string, unknown> = {};
              for (let i = 0; i < cols.length; i++) {
                obj[cols[i]!] = row[i];
              }
              return obj;
            });
          };
        }
      }
    } catch (e) {
      log(`exec() probe failed: ${e}`);
    }
  }

  log("WARNING: No working query method found, queries will return []");
  return async () => [];
}

async function query(db: Database, sql: string): Promise<Record<string, unknown>[]> {
  if (!queryFn) {
    queryFn = await probeQueryMethod(db);
  }
  return queryFn(db, sql);
}

// Cached write function, determined once during initDatabase().
type WriteFn = (db: Database, sql: string) => Promise<void>;
let writeFn: WriteFn | null = null;

function probeWriteMethod(db: Database): WriteFn {
  const dbAny = db as unknown as Record<string, unknown>;
  if (typeof dbAny.exec === "function") {
    return async (d, sql) => {
      await ((d as unknown as Record<string, unknown>).exec as (sql: string) => Promise<void>).call(d, sql);
    };
  }
  if (typeof dbAny.run === "function") {
    return async (d, sql) => {
      await ((d as unknown as Record<string, unknown>).run as (sql: string) => Promise<void>).call(d, sql);
    };
  }
  throw new Error("No exec or run method on database");
}

async function sqlRun(db: Database, sql: string): Promise<void> {
  if (!writeFn) {
    writeFn = probeWriteMethod(db);
  }
  return writeFn(db, sql);
}

async function initDatabase(): Promise<Database> {
  if (!sdkRef) throw new Error("SDK not set");
  log("Initializing database...");
  const db: Database = await sdkRef.meta.db();

  // Probe and cache query/write methods
  queryFn = await probeQueryMethod(db);
  writeFn = probeWriteMethod(db);

  await sqlRun(db, `CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    "group" TEXT DEFAULT '',
    show_preview INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    detection_binary TEXT DEFAULT NULL
  )`);

  await sqlRun(db, `CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    request_id TEXT,
    batch_id TEXT DEFAULT NULL,
    resolved_command TEXT NOT NULL,
    stdout TEXT DEFAULT '',
    stderr TEXT DEFAULT '',
    exit_code INTEGER,
    status TEXT DEFAULT 'running',
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`);

  // Seed presets if empty
  try {
    const rows = await query(db, "SELECT COUNT(*) as count FROM tools");
    const first = rows[0];
    const count = Number(first?.count ?? first?.["COUNT(*)"] ?? 0);
    if (count === 0) {
      log("Seeding default presets...");
      for (const preset of DEFAULT_PRESETS) {
        await execInsertTool(db, preset);
      }
      log(`Seeded ${DEFAULT_PRESETS.length} presets`);
    } else {
      log(`Found ${count} existing tools`);
    }
  } catch (err) {
    logError(`Seeding failed: ${err}`);
  }

  log("Database ready");
  return db;
}

function buildInsertToolSql(tool: ToolConfig): string {
  const detBin = tool.detectionBinary !== undefined
    ? `'${sqlEscape(tool.detectionBinary)}'`
    : "NULL";
  return `INSERT OR REPLACE INTO tools (id, name, command, "group", show_preview, enabled, sort_order, detection_binary)
    VALUES ('${sqlEscape(tool.id)}', '${sqlEscape(tool.name)}', '${sqlEscape(tool.command)}', '${sqlEscape(tool.group)}', ${tool.showPreview ? 1 : 0}, ${tool.enabled ? 1 : 0}, ${tool.sortOrder}, ${detBin})`;
}

async function execInsertTool(db: Database, tool: ToolConfig): Promise<void> {
  await sqlRun(db, buildInsertToolSql(tool));
}

// --- Row mapping ---

function rowToTool(row: Record<string, unknown>): ToolConfig {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    command: String(row.command ?? ""),
    group: String(row.group ?? ""),
    showPreview: Boolean(row.show_preview),
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
    detectionBinary: row.detection_binary !== null && row.detection_binary !== undefined
      ? String(row.detection_binary)
      : undefined,
  };
}

function rowToRunEntry(row: Record<string, unknown>): RunEntry {
  return {
    id: String(row.id ?? ""),
    toolId: String(row.tool_id ?? ""),
    toolName: String(row.tool_name ?? ""),
    requestId: row.request_id !== null && row.request_id !== undefined ? String(row.request_id) : null,
    batchId: row.batch_id !== null && row.batch_id !== undefined ? String(row.batch_id) : null,
    resolvedCommand: String(row.resolved_command ?? ""),
    stdout: String(row.stdout ?? ""),
    stderr: String(row.stderr ?? ""),
    exitCode: row.exit_code !== null && row.exit_code !== undefined ? Number(row.exit_code) : null,
    startedAt: String(row.started_at ?? ""),
    finishedAt: row.finished_at !== null && row.finished_at !== undefined ? String(row.finished_at) : null,
    status: String(row.status ?? "running") as RunEntry["status"],
  };
}

// --- Tools CRUD ---

export async function insertTool(tool: ToolConfig): Promise<void> {
  const db = await getDb();
  await execInsertTool(db, tool);
}

export async function getAllTools(): Promise<ToolConfig[]> {
  const db = await getDb();
  const rows = await query(db, "SELECT * FROM tools ORDER BY sort_order, name");
  return rows.map(rowToTool);
}

export async function getToolById(id: string): Promise<ToolConfig | undefined> {
  const db = await getDb();
  const rows = await query(db, `SELECT * FROM tools WHERE id = '${sqlEscape(id)}'`);
  return rows.length > 0 ? rowToTool(rows[0]!) : undefined;
}

export async function deleteToolById(id: string): Promise<void> {
  const db = await getDb();
  await sqlRun(db, `DELETE FROM tools WHERE id = '${sqlEscape(id)}'`);
}

export async function updateToolOrder(ids: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < ids.length; i++) {
    await sqlRun(db, `UPDATE tools SET sort_order = ${i} WHERE id = '${sqlEscape(ids[i]!)}'`);
  }
}

export async function deleteAllTools(): Promise<void> {
  const db = await getDb();
  await sqlRun(db, "DELETE FROM tools");
}

// --- History ---

export async function insertHistoryEntry(entry: RunEntry): Promise<void> {
  const db = await getDb();
  const reqId = entry.requestId !== null ? `'${sqlEscape(entry.requestId)}'` : "NULL";
  const batchId = entry.batchId !== null ? `'${sqlEscape(entry.batchId)}'` : "NULL";
  const exitCode = entry.exitCode !== null ? entry.exitCode : "NULL";
  const finishedAt = entry.finishedAt !== null ? `'${sqlEscape(entry.finishedAt)}'` : "NULL";

  await sqlRun(db,
    `INSERT INTO history (id, tool_id, tool_name, request_id, batch_id, resolved_command, stdout, stderr, exit_code, status, started_at, finished_at)
     VALUES ('${sqlEscape(entry.id)}', '${sqlEscape(entry.toolId)}', '${sqlEscape(entry.toolName)}', ${reqId}, ${batchId}, '${sqlEscape(entry.resolvedCommand)}', '${sqlEscape(entry.stdout)}', '${sqlEscape(entry.stderr)}', ${exitCode}, '${sqlEscape(entry.status)}', '${sqlEscape(entry.startedAt)}', ${finishedAt})`
  );
}

export async function updateHistoryEntry(
  runId: string,
  updates: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    status?: string;
    finishedAt?: string;
  }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];

  if (updates.stdout !== undefined) sets.push(`stdout = '${sqlEscape(updates.stdout)}'`);
  if (updates.stderr !== undefined) sets.push(`stderr = '${sqlEscape(updates.stderr)}'`);
  if (updates.exitCode !== undefined) sets.push(`exit_code = ${updates.exitCode}`);
  if (updates.status !== undefined) sets.push(`status = '${sqlEscape(updates.status)}'`);
  if (updates.finishedAt !== undefined) sets.push(`finished_at = '${sqlEscape(updates.finishedAt)}'`);

  if (sets.length > 0) {
    await sqlRun(db, `UPDATE history SET ${sets.join(", ")} WHERE id = '${sqlEscape(runId)}'`);
  }
}

export async function getHistoryEntries(limit?: number): Promise<RunEntry[]> {
  const db = await getDb();
  const sql = limit !== undefined
    ? `SELECT * FROM history ORDER BY started_at DESC LIMIT ${limit}`
    : "SELECT * FROM history ORDER BY started_at DESC";
  const rows = await query(db, sql);
  return rows.map(rowToRunEntry);
}

export async function getRunOutputById(runId: string): Promise<{ stdout: string; stderr: string }> {
  const db = await getDb();
  const rows = await query(db, `SELECT stdout, stderr FROM history WHERE id = '${sqlEscape(runId)}'`);
  if (rows.length === 0) return { stdout: "", stderr: "" };
  return {
    stdout: String(rows[0]!.stdout ?? ""),
    stderr: String(rows[0]!.stderr ?? ""),
  };
}

export async function clearAllHistory(): Promise<void> {
  const db = await getDb();
  await sqlRun(db, "DELETE FROM history");
}
