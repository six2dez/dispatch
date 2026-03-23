import type { Database } from "sqlite";
import type { ToolConfig, RunEntry } from "./types";
import { DEFAULT_PRESETS } from "./presets";

let dbPromise: Promise<Database> | null = null;
let sdk_ref: any = null;

export function setSdkRef(sdk: any): void {
  sdk_ref = sdk;
}

function log(msg: string): void {
  try {
    sdk_ref?.console?.log(`[Dispatch] ${msg}`);
  } catch {}
}

function logError(msg: string): void {
  try {
    sdk_ref?.console?.error(`[Dispatch] ${msg}`);
  } catch {}
}

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    if (!sdk_ref) throw new Error("SDK not set");
    dbPromise = initDatabase();
  }
  return dbPromise;
}

// SQL escape for string values
function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

// --- Auto-detect query API ---

// Cached query function, determined once during initDatabase().
let queryFn: ((db: any, sql: string) => Promise<any[]>) | null = null;

// Probe the DB object to find a working query method and cache it.
// Caido versions differ: some have prepare(), some have query(), some only exec().
async function probeQueryMethod(db: any): Promise<(db: any, sql: string) => Promise<any[]>> {
  const testSql = "SELECT 1 as _probe";

  // Method 1: prepare().all()
  if (typeof db.prepare === "function") {
    try {
      const stmt = db.prepare(testSql);
      const resolved = stmt && typeof stmt.then === "function" ? await stmt : stmt;
      if (resolved && typeof resolved.all === "function") {
        const rows = await resolved.all();
        if (Array.isArray(rows)) {
          log("Using query method: prepare().all()");
          return async (d: any, sql: string) => {
            const s = d.prepare(sql);
            const r = s && typeof s.then === "function" ? await s : s;
            return (r && typeof r.all === "function") ? await r.all() : [];
          };
        }
      }
    } catch (e) {
      log(`prepare().all() probe failed: ${e}`);
    }
  }

  // Method 2: db.query()
  if (typeof db.query === "function") {
    try {
      const rows = await db.query(testSql);
      if (Array.isArray(rows)) {
        log("Using query method: db.query()");
        return async (d: any, sql: string) => {
          const r = await d.query(sql);
          return Array.isArray(r) ? r : [];
        };
      }
    } catch (e) {
      log(`db.query() probe failed: ${e}`);
    }
  }

  // Method 3: db.all()
  if (typeof db.all === "function") {
    try {
      const rows = await db.all(testSql);
      if (Array.isArray(rows)) {
        log("Using query method: db.all()");
        return async (d: any, sql: string) => {
          const r = await d.all(sql);
          return Array.isArray(r) ? r : [];
        };
      }
    } catch (e) {
      log(`db.all() probe failed: ${e}`);
    }
  }

  // Method 4: db.select()
  if (typeof db.select === "function") {
    try {
      const rows = await db.select(testSql);
      if (Array.isArray(rows)) {
        log("Using query method: db.select()");
        return async (d: any, sql: string) => {
          const r = await d.select(sql);
          return Array.isArray(r) ? r : [];
        };
      }
    } catch (e) {
      log(`db.select() probe failed: ${e}`);
    }
  }

  // Method 5: exec() might return rows in some versions
  if (typeof db.exec === "function") {
    try {
      const result = await db.exec(testSql);
      if (Array.isArray(result) || (result && typeof result === "object" && (Array.isArray(result.rows) || Array.isArray(result.values)))) {
        log("Using query method: db.exec()");
        return async (d: any, sql: string) => {
          const r = await d.exec(sql);
          if (Array.isArray(r)) return r;
          if (r && typeof r === "object") {
            if (Array.isArray(r.rows)) return r.rows;
            if (Array.isArray(r.values)) {
              // Convert tuples to objects using column names if available
              if (Array.isArray(r.columns) && r.columns.length > 0) {
                return r.values.map((row: any[]) => {
                  const obj: Record<string, any> = {};
                  for (let i = 0; i < r.columns.length; i++) {
                    obj[r.columns[i]] = row[i];
                  }
                  return obj;
                });
              }
              return r.values;
            }
          }
          return [];
        };
      }
    } catch (e) {
      log(`exec() probe failed: ${e}`);
    }
  }

  log("WARNING: No working query method found, queries will return []");
  return async (_d: any, sql: string) => {
    log(`WARNING: No query method available for: ${sql.slice(0, 80)}`);
    return [];
  };
}

async function query(db: any, sql: string): Promise<any[]> {
  if (!queryFn) {
    // Fallback: should not happen if initDatabase ran, but be safe
    queryFn = await probeQueryMethod(db);
  }
  return queryFn(db, sql);
}

// Run a write statement (INSERT/UPDATE/DELETE)
async function sqlRun(db: any, sql: string): Promise<void> {
  if (typeof db.exec === "function") {
    await db.exec(sql);
    return;
  }
  if (typeof db.run === "function") {
    await db.run(sql);
    return;
  }
  throw new Error("No exec or run method on database");
}

async function initDatabase(): Promise<Database> {
  log("Initializing database...");
  const db = await sdk_ref.meta.db();

  // Log available methods for debugging
  try {
    const proto = Object.getPrototypeOf(db);
    const protoMethods = proto
      ? Object.getOwnPropertyNames(proto).filter(
          (k: string) => typeof db[k] === "function"
        )
      : [];
    const ownMethods = Object.getOwnPropertyNames(db).filter(
      (k: string) => typeof db[k] === "function"
    );
    log(`DB proto methods: ${protoMethods.join(", ") || "(none)"}`);
    log(`DB own methods: ${ownMethods.join(", ") || "(none)"}`);
    log(`DB keys: ${Object.keys(db).join(", ") || "(none)"}`);
  } catch (e) {
    log(`Failed to inspect DB: ${e}`);
  }

  // Probe and cache the working query method
  queryFn = await probeQueryMethod(db);

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
  log("Created tools table");

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
  log("Created history table");

  // Seed presets if empty
  try {
    const rows = await query(db, "SELECT COUNT(*) as count FROM tools");
    log(`Count query returned: ${JSON.stringify(rows)}`);
    const count = Number(rows?.[0]?.count ?? rows?.[0]?.["COUNT(*)"] ?? 0);
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
  const detBin = tool.detectionBinary
    ? `'${sqlEscape(tool.detectionBinary)}'`
    : "NULL";
  return `INSERT OR REPLACE INTO tools (id, name, command, "group", show_preview, enabled, sort_order, detection_binary)
    VALUES ('${sqlEscape(tool.id)}', '${sqlEscape(tool.name)}', '${sqlEscape(tool.command)}', '${sqlEscape(tool.group)}', ${tool.showPreview ? 1 : 0}, ${tool.enabled ? 1 : 0}, ${tool.sortOrder}, ${detBin})`;
}

async function execInsertTool(db: any, tool: ToolConfig): Promise<void> {
  await sqlRun(db, buildInsertToolSql(tool));
}

// --- Row types ---

interface ToolRow {
  id: string;
  name: string;
  command: string;
  group: string;
  show_preview: number;
  enabled: number;
  sort_order: number;
  detection_binary: string | null;
}

interface HistoryRow {
  id: string;
  tool_id: string;
  tool_name: string;
  request_id: string | null;
  batch_id: string | null;
  resolved_command: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  status: string;
  started_at: string;
  finished_at: string | null;
}

function rowToTool(row: ToolRow): ToolConfig {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    group: row.group,
    showPreview: Boolean(row.show_preview),
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    detectionBinary: row.detection_binary ?? undefined,
  };
}

function rowToRunEntry(row: HistoryRow): RunEntry {
  return {
    id: row.id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    requestId: row.request_id,
    batchId: row.batch_id,
    resolvedCommand: row.resolved_command,
    stdout: row.stdout,
    stderr: row.stderr,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as RunEntry["status"],
  };
}

// --- Tools CRUD ---

export async function insertTool(tool: ToolConfig): Promise<void> {
  const db = await getDb();
  await execInsertTool(db, tool);
}

export async function getAllTools(): Promise<ToolConfig[]> {
  const db = await getDb();
  const rows = await query(
    db,
    "SELECT * FROM tools ORDER BY sort_order, name"
  );
  return rows.map(rowToTool);
}

export async function getToolById(
  id: string
): Promise<ToolConfig | undefined> {
  const db = await getDb();
  const rows = await query(
    db,
    `SELECT * FROM tools WHERE id = '${sqlEscape(id)}'`
  );
  return rows.length > 0 ? rowToTool(rows[0]) : undefined;
}

export async function deleteToolById(id: string): Promise<void> {
  const db = await getDb();
  await sqlRun(db, `DELETE FROM tools WHERE id = '${sqlEscape(id)}'`);
}

export async function updateToolOrder(ids: string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < ids.length; i++) {
    await sqlRun(
      db,
      `UPDATE tools SET sort_order = ${i} WHERE id = '${sqlEscape(ids[i]!)}'`
    );
  }
}

export async function deleteAllTools(): Promise<void> {
  const db = await getDb();
  await sqlRun(db, "DELETE FROM tools");
}

// --- History ---

export async function insertHistoryEntry(entry: RunEntry): Promise<void> {
  const db = await getDb();
  const reqId = entry.requestId ? `'${sqlEscape(entry.requestId)}'` : "NULL";
  const batchId = entry.batchId ? `'${sqlEscape(entry.batchId)}'` : "NULL";
  const exitCode = entry.exitCode !== null ? entry.exitCode : "NULL";
  const finishedAt = entry.finishedAt
    ? `'${sqlEscape(entry.finishedAt)}'`
    : "NULL";

  await sqlRun(
    db,
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

  if (updates.stdout !== undefined)
    sets.push(`stdout = '${sqlEscape(updates.stdout)}'`);
  if (updates.stderr !== undefined)
    sets.push(`stderr = '${sqlEscape(updates.stderr)}'`);
  if (updates.exitCode !== undefined)
    sets.push(`exit_code = ${updates.exitCode}`);
  if (updates.status !== undefined)
    sets.push(`status = '${sqlEscape(updates.status)}'`);
  if (updates.finishedAt !== undefined)
    sets.push(`finished_at = '${sqlEscape(updates.finishedAt)}'`);

  if (sets.length > 0) {
    await sqlRun(
      db,
      `UPDATE history SET ${sets.join(", ")} WHERE id = '${sqlEscape(runId)}'`
    );
  }
}

export async function getHistoryEntries(
  limit?: number
): Promise<RunEntry[]> {
  const db = await getDb();
  const sql = limit
    ? `SELECT * FROM history ORDER BY started_at DESC LIMIT ${limit}`
    : "SELECT * FROM history ORDER BY started_at DESC";
  const rows = await query(db, sql);
  return rows.map(rowToRunEntry);
}

export async function getRunOutputById(
  runId: string
): Promise<{ stdout: string; stderr: string }> {
  const db = await getDb();
  const rows = await query(
    db,
    `SELECT stdout, stderr FROM history WHERE id = '${sqlEscape(runId)}'`
  );
  if (rows.length === 0) return { stdout: "", stderr: "" };
  return {
    stdout: rows[0].stdout ?? "",
    stderr: rows[0].stderr ?? "",
  };
}

export async function clearAllHistory(): Promise<void> {
  const db = await getDb();
  await sqlRun(db, "DELETE FROM history");
}
