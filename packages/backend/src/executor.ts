import { spawn, ChildProcess } from "child_process";
import { rmSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { tmpdir, platform } from "os";
import type { SDK } from "caido:plugin";
import type { API, Events } from "./index";
import { insertHistoryEntry, updateHistoryEntry } from "./db";

type PluginSDK = SDK<API, Events>;

const IS_MAC = platform() === "darwin";
const MAX_STORED_OUTPUT = 512 * 1024; // 512KB per stream
const MAX_CONCURRENT = 10;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TEMP_AGE_MS = 10 * 60 * 1000;

let sdkRef: PluginSDK | undefined;

export function setExecutorSdk(sdk: PluginSDK): void {
  sdkRef = sdk;
}

const activeProcesses = new Map<string, ChildProcess>();
const killedRunIds = new Set<string>();

function logError(msg: string): void {
  sdkRef?.console?.error(`[Dispatch] ${msg}`);
}

export function getActiveCount(): number {
  return activeProcesses.size;
}

export function isAtCapacity(): boolean {
  return activeProcesses.size >= MAX_CONCURRENT;
}

// Spawn using user's login shell to inherit full PATH
function spawnWithLoginShell(command: string): ChildProcess {
  try {
    if (IS_MAC) {
      return spawn("/bin/zsh", ["-lc", command]);
    }
    return spawn("/bin/bash", ["-lc", command]);
  } catch {
    return spawn("sh", ["-c", command]);
  }
}

// Kill entire process tree — not just the shell
// Uses shell commands to kill the process group, avoiding orphans from pipes
function killProcessTree(child: ChildProcess, signal: string): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill();
    return;
  }

  // Use shell to kill the process group and children
  // kill -- -PID sends signal to entire process group
  // pkill -P as fallback kills direct children
  try {
    spawn("sh", ["-c", `kill -s ${signal} -- -${pid} 2>/dev/null || (pkill -${signal} -P ${pid} 2>/dev/null; kill -s ${signal} ${pid} 2>/dev/null)`]);
  } catch {
    try {
      child.kill();
    } catch {
      // Process already dead
    }
  }
}

function spawnAndTrack(
  sdk: PluginSDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolName: string,
  requestId: string | null,
  startedAt: string,
  onClose?: () => void
): void {
  if (isAtCapacity()) {
    logError(`Max concurrent processes (${MAX_CONCURRENT}) reached, rejecting ${runId}`);
    updateHistoryEntry(runId, {
      status: "error",
      stderr: `Rejected: max concurrent processes (${MAX_CONCURRENT}) reached`,
      exitCode: -1,
      finishedAt: new Date().toISOString(),
    }).catch((e) => logError(`updateHistoryEntry failed: ${e}`));
    onClose?.();
    return;
  }

  sdk.api.send("terminal:start", {
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

  child.stdout?.on("data", (data) => {
    const chunk = data.toString();
    stdoutBuf += chunk;
    if (stdoutBuf.length > MAX_STORED_OUTPUT) {
      stdoutBuf = stdoutBuf.slice(-MAX_STORED_OUTPUT);
    }
    sdk.api.send("terminal:output", { runId, data: chunk, stream: "stdout" as const });
  });

  child.stderr?.on("data", (data) => {
    const chunk = data.toString();
    stderrBuf += chunk;
    if (stderrBuf.length > MAX_STORED_OUTPUT) {
      stderrBuf = stderrBuf.slice(-MAX_STORED_OUTPUT);
    }
    sdk.api.send("terminal:output", { runId, data: chunk, stream: "stderr" as const });
  });

  child.on("close", (exitCode: number | null) => {
    const finishedAt = new Date().toISOString();
    const duration = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    const wasKilled = killedRunIds.has(runId);
    killedRunIds.delete(runId);
    activeProcesses.delete(runId);

    updateHistoryEntry(runId, {
      stdout: stdoutBuf,
      stderr: stderrBuf,
      exitCode: exitCode ?? -1,
      status: wasKilled ? "killed" : "completed",
      finishedAt,
    }).catch((e) => logError(`updateHistoryEntry failed: ${e}`));

    sdk.api.send("terminal:exit", { runId, exitCode: exitCode ?? -1, duration });

    cleanupTempFiles(tempFiles);
    onClose?.();
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
  batchId: string | null
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

  spawnAndTrack(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt);
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
  batchId: string | null
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
    spawnAndTrack(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt, resolve);
  });
}

export function killActiveProcess(runId: string): boolean {
  const proc = activeProcesses.get(runId);
  if (!proc) return false;

  killedRunIds.add(runId);
  killProcessTree(proc, "TERM");

  // Fallback to SIGKILL after 5s if process still alive
  setTimeout(() => {
    if (activeProcesses.has(runId)) {
      killProcessTree(proc, "KILL");
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
