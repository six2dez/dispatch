import { spawn, ChildProcess } from "child_process";
import { rmSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { tmpdir, platform } from "os";
import type { SDK } from "caido:plugin";
import type { API, Events } from "./index";
import { insertHistoryEntry, updateHistoryEntry } from "./db";

type PluginSDK = SDK<API, Events>;

const IS_MAC = platform() === "darwin";
const USE_PROCESS_GROUPS = platform() !== "win32";
const MAX_STORED_OUTPUT = 512 * 1024; // 512KB per stream
const MAX_CONCURRENT = 10;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TEMP_AGE_MS = 10 * 60 * 1000;

let sdkRef: PluginSDK | undefined;

export function setExecutorSdk(sdk: PluginSDK): void {
  sdkRef = sdk;
}

const activeProcesses = new Map<string, ChildProcess>();
const reservedSlots = new Set<string>();
const killedRunIds = new Set<string>();

function logError(msg: string): void {
  sdkRef?.console?.error(`[Dispatch] ${msg}`);
}

// Wrap sdk.api.send so a throw from the event bus can't kill the stream
// handler and silently strand the run.
function safeSend(sdk: PluginSDK, event: string, payload: unknown): void {
  try {
    (sdk.api.send as unknown as (ev: string, data: unknown) => void)(event, payload);
  } catch (err) {
    logError(`api.send(${event}) failed: ${err}`);
  }
}

export function getActiveCount(): number {
  return activeProcesses.size + reservedSlots.size;
}

export function getMaxConcurrent(): number {
  return MAX_CONCURRENT;
}

export function isAtCapacity(): boolean {
  return activeProcesses.size + reservedSlots.size >= MAX_CONCURRENT;
}

/**
 * Atomically reserve a concurrency slot. Synchronous — callers can reserve
 * before any `await`, guaranteeing that concurrent `executeCommand` calls
 * cannot collectively exceed `MAX_CONCURRENT` between the capacity check
 * and the actual spawn.
 *
 * Returns true when the slot is reserved and the caller must either call
 * `executeToolCommand[Async]` (which consumes the reservation in
 * `spawnAndTrack`) or `releaseSlot(runId)` on error.
 */
export function reserveSlot(runId: string): boolean {
  if (isAtCapacity()) return false;
  reservedSlots.add(runId);
  return true;
}

export function releaseSlot(runId: string): void {
  reservedSlots.delete(runId);
}

// Spawn using user's login shell to inherit full PATH.
// `stdio` is forced explicitly so the Node runtime embedded in Caido creates
// pipes for stdout/stderr even when `detached: true` — without this, the
// `on("data")` events never fired on some hosts and runs looked stuck at
// "Running…" with empty output despite exiting cleanly.
function spawnWithLoginShell(command: string): ChildProcess {
  const opts = {
    detached: USE_PROCESS_GROUPS,
    stdio: ["ignore", "pipe", "pipe"] as ("ignore" | "pipe")[],
  };
  try {
    if (IS_MAC) {
      return spawn("/bin/zsh", ["-lc", command], opts);
    }
    return spawn("/bin/bash", ["-lc", command], opts);
  } catch {
    return spawn("sh", ["-c", command], opts);
  }
}

// Kill entire process tree — not just the shell
function killProcessTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }

  if (USE_PROCESS_GROUPS) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to direct child termination if the process group no longer exists.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Process already dead
  }
}

function appendOutputChunk(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > MAX_STORED_OUTPUT
    ? next.slice(-MAX_STORED_OUTPUT)
    : next;
}

function spawnAndTrack(
  sdk: PluginSDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolName: string,
  requestId: string | null,
  startedAt: string,
  timeoutMs: number | null,
  onClose?: () => void
): void {
  // Consume the reservation (if any). If the caller didn't reserve we fall
  // back to a capacity check as defense-in-depth — should not happen in
  // normal flow but keeps the limit honest if a future caller forgets to
  // reserve.
  const hadReservation = reservedSlots.delete(runId);
  if (!hadReservation && activeProcesses.size >= MAX_CONCURRENT) {
    logError(`Max concurrent processes (${MAX_CONCURRENT}) reached, rejecting ${runId}`);
    cleanupTempFiles(tempFiles);
    updateHistoryEntry(runId, {
      status: "error",
      stderr: `Rejected: max concurrent processes (${MAX_CONCURRENT}) reached`,
      exitCode: -1,
      finishedAt: new Date().toISOString(),
    }).catch((e) => logError(`updateHistoryEntry failed: ${e}`));
    onClose?.();
    return;
  }

  safeSend(sdk, "terminal:start", {
    runId,
    toolName,
    resolvedCommand,
    requestId,
    startedAt,
  });

  const child = spawnWithLoginShell(resolvedCommand);
  activeProcesses.set(runId, child);

  let stdoutBuf = "";
  let stderrBuf = "";
  let finalized = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutEscalation: ReturnType<typeof setTimeout> | null = null;

  const effectiveTimeout = timeoutMs !== null && timeoutMs > 0 ? timeoutMs : 0;
  if (effectiveTimeout > 0) {
    timeoutTimer = setTimeout(() => {
      if (finalized || !activeProcesses.has(runId)) return;
      const msg = `\n[Dispatch] Timeout reached (${effectiveTimeout} ms), killing process\n`;
      stderrBuf = appendOutputChunk(stderrBuf, msg);
      safeSend(sdk, "terminal:output", { runId, data: msg, stream: "stderr" as const });
      killedRunIds.add(runId);
      killProcessTree(child, "SIGTERM");
      timeoutEscalation = setTimeout(() => {
        if (!finalized && activeProcesses.has(runId)) {
          killProcessTree(child, "SIGKILL");
        }
      }, 5000);
    }, effectiveTimeout);
  }

  function finalize(exitCode: number, status: "completed" | "error" | "killed", errorMessage?: string): void {
    if (finalized) return;
    finalized = true;

    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (timeoutEscalation) {
      clearTimeout(timeoutEscalation);
      timeoutEscalation = null;
    }

    if (errorMessage) {
      stderrBuf = appendOutputChunk(stderrBuf, `${errorMessage}\n`);
      safeSend(sdk, "terminal:output", { runId, data: `${errorMessage}\n`, stream: "stderr" as const });
    }

    const finishedAt = new Date().toISOString();
    const duration = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    killedRunIds.delete(runId);
    activeProcesses.delete(runId);

    updateHistoryEntry(runId, {
      stdout: stdoutBuf,
      stderr: stderrBuf,
      exitCode,
      status,
      finishedAt,
    }).catch((e) => logError(`updateHistoryEntry failed: ${e}`));

    safeSend(sdk, "terminal:exit", { runId, exitCode, duration });

    cleanupTempFiles(tempFiles);
    onClose?.();
  }

  child.stdout?.on("data", (data) => {
    const chunk = data.toString();
    stdoutBuf = appendOutputChunk(stdoutBuf, chunk);
    safeSend(sdk, "terminal:output", { runId, data: chunk, stream: "stdout" as const });
  });

  child.stderr?.on("data", (data) => {
    const chunk = data.toString();
    stderrBuf = appendOutputChunk(stderrBuf, chunk);
    safeSend(sdk, "terminal:output", { runId, data: chunk, stream: "stderr" as const });
  });

  child.stdout?.on("error", (err) => logError(`stdout error ${runId}: ${err}`));
  child.stderr?.on("error", (err) => logError(`stderr error ${runId}: ${err}`));

  child.on("close", (exitCode: number | null) => {
    const wasKilled = killedRunIds.has(runId);
    const finalExitCode = exitCode ?? -1;
    const status = wasKilled
      ? "killed"
      : finalExitCode === 0
        ? "completed"
        : "error";
    finalize(finalExitCode, status);
  });

  child.on("error", (error) => {
    finalize(-1, "error", error.message);
  });
}

/** Fire-and-forget: inserts history then spawns immediately. */
export function executeToolCommand(
  sdk: PluginSDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolId: string,
  toolName: string,
  requestId: string | null,
  batchId: string | null,
  timeoutMs: number | null = null
): void {
  const startedAt = new Date().toISOString();

  insertHistoryEntry({
    id: runId,
    toolId,
    toolName,
    requestId,
    batchId,
    resolvedCommand,
    stdout: "",
    stderr: "",
    exitCode: null,
    status: "running",
    startedAt,
    finishedAt: null,
  }).catch((e) => logError(`insertHistoryEntry failed: ${e}`));

  spawnAndTrack(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt, timeoutMs);
}

/** Async version: awaits DB insert, resolves when child closes. */
export async function executeToolCommandAsync(
  sdk: PluginSDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolId: string,
  toolName: string,
  requestId: string | null,
  batchId: string | null,
  timeoutMs: number | null = null
): Promise<void> {
  const startedAt = new Date().toISOString();

  await insertHistoryEntry({
    id: runId,
    toolId,
    toolName,
    requestId,
    batchId,
    resolvedCommand,
    stdout: "",
    stderr: "",
    exitCode: null,
    status: "running",
    startedAt,
    finishedAt: null,
  });

  return new Promise((resolve) => {
    spawnAndTrack(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt, timeoutMs, resolve);
  });
}

export function killActiveProcess(runId: string): boolean {
  const proc = activeProcesses.get(runId);
  if (!proc) return false;

  killedRunIds.add(runId);
  killProcessTree(proc, "SIGTERM");

  // Fallback to SIGKILL after 5s if process still alive
  setTimeout(() => {
    if (activeProcesses.has(runId)) {
      killProcessTree(proc, "SIGKILL");
    }
  }, 5000);

  return true;
}

function cleanupTempFiles(tempFiles: string[]): void {
  if (tempFiles.length > 0) {
    try {
      const dir = dirname(tempFiles[0]!);
      rmSync(dir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Periodic cleanup of stale dispatch- temp directories
function cleanupStaleTempDirs(): void {
  try {
    const tmp = tmpdir();
    const entries = readdirSync(tmp);
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.startsWith("dispatch-")) continue;
      const fullPath = join(tmp, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory() && now - stat.mtimeMs > MAX_TEMP_AGE_MS) {
          rmSync(fullPath, { recursive: true });
        }
      } catch {
        // Ignore individual errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startPeriodicCleanup(): void {
  if (cleanupTimer) return;
  cleanupStaleTempDirs();
  cleanupTimer = setInterval(cleanupStaleTempDirs, CLEANUP_INTERVAL_MS);
}
