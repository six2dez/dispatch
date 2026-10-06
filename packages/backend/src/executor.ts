import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { rmSync } from "fs";
import { dirname } from "path";
import { platform } from "os";
import type { SDK } from "caido:plugin";
import type { API, Events } from "./index";
import { insertHistoryEntry, updateHistoryEntry } from "./db";
import { chunkToString, spawnInUserShell } from "./shell";

type PluginSDK = SDK<API, Events>;

const USE_PROCESS_GROUPS = platform() !== "win32";
const MAX_STORED_OUTPUT = 512 * 1024; // 512KB per stream
const MAX_CONCURRENT = 10;

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

// Kill entire process tree — not just the shell
function killProcessTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }

  if (USE_PROCESS_GROUPS) {
    // Node: signal the whole group directly. Caido's runtime has no `process`
    // global (shell.ts module doc), so without this guard line 84 threw
    // ReferenceError and cancelled runs left the tool itself running — the
    // fallback asks a spawned shell's kill builtin to signal the group.
    if (typeof process !== "undefined" && typeof process.kill === "function") {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // Fall through: the process group may no longer exist.
      }
    } else {
      try {
        const killer = spawn("/bin/sh", ["-c", `kill -s ${signal} -${pid} 2>/dev/null || true`], {
          stdio: "ignore",
        });
        killer.on("error", () => { /* no kill(1) — nothing more we can do */ });
        return;
      } catch {
        // Fall through to direct child termination.
      }
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
  void trackSpawn(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt, timeoutMs, onClose);
}

async function trackSpawn(
  sdk: PluginSDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolName: string,
  requestId: string | null,
  startedAt: string,
  timeoutMs: number | null,
  onClose?: () => void
): Promise<void> {
  // Defense-in-depth capacity check. `reservedSlots` is intentionally left
  // holding this run across the await below, so a concurrent dispatch cannot
  // start while this one is still being spawned.
  if (!reservedSlots.has(runId) && activeProcesses.size >= MAX_CONCURRENT) {
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

  let child: ChildProcess;
  try {
    child = await spawnInUserShell(resolvedCommand, {
      detached: USE_PROCESS_GROUPS,
    });
  } catch (err) {
    // Never announce a start we could not deliver, so the UI cannot be left
    // showing a run that will never produce output or an exit event.
    logError(`Failed to spawn ${runId}: ${err}`);
    reservedSlots.delete(runId);
    cleanupTempFiles(tempFiles);
    updateHistoryEntry(runId, {
      status: "error",
      stderr: `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: -1,
      finishedAt: new Date().toISOString(),
    }).catch((e) => logError(`updateHistoryEntry failed: ${e}`));
    onClose?.();
    return;
  }

  // Process is live: swap the reservation for a tracked process.
  reservedSlots.delete(runId);

  safeSend(sdk, "terminal:start", {
    runId,
    toolName,
    resolvedCommand,
    requestId,
    startedAt,
  });

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
    const chunk = chunkToString(data);
    stdoutBuf = appendOutputChunk(stdoutBuf, chunk);
    safeSend(sdk, "terminal:output", { runId, data: chunk, stream: "stdout" as const });
  });

  child.stderr?.on("data", (data) => {
    const chunk = chunkToString(data);
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
