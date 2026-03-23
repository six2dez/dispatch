import { spawn, ChildProcess } from "child_process";
import { rmSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { tmpdir, platform } from "os";
import type { SDK } from "caido:plugin";
import { insertHistoryEntry, updateHistoryEntry } from "./db";

const IS_MAC = platform() === "darwin";

let sdkRef: any = null;

export function setExecutorSdk(sdk: any): void {
  sdkRef = sdk;
}

const activeProcesses = new Map<string, ChildProcess>();
const killedRunIds = new Set<string>();
const MAX_STORED_OUTPUT = 512 * 1024; // 512KB

// Spawn using user's login shell to inherit full PATH
function spawnWithLoginShell(command: string): ChildProcess {
  // macOS: zsh, Linux/other: bash, final fallback: plain shell
  try {
    if (IS_MAC) {
      return spawn("/bin/zsh", ["-lc", command]);
    }
    return spawn("/bin/bash", ["-lc", command]);
  } catch {
    return spawn("sh", ["-c", command]);
  }
}

// Periodic cleanup interval (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// Max age for temp directories (10 minutes)
const MAX_TEMP_AGE_MS = 10 * 60 * 1000;

// Helper to send events — bypasses strict keyof Events typing on SDK<{},{}>
function sendEvent(sdk: SDK, event: string, data: unknown): void {
  (sdk.api.send as (event: string, data: unknown) => void)(event, data);
}

function spawnAndTrack(
  sdk: SDK,
  runId: string,
  resolvedCommand: string,
  tempFiles: string[],
  toolName: string,
  requestId: string | null,
  startedAt: string,
  onClose?: () => void
): void {
  sendEvent(sdk, "terminal:start", {
    runId,
    toolName,
    resolvedCommand,
    requestId,
    startedAt,
  });

  const child = spawnWithLoginShell(resolvedCommand);
  activeProcesses.set(runId, child);

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout?.on("data", (data) => {
    const chunk = data.toString();
    stdoutBuffer += chunk;
    if (stdoutBuffer.length > MAX_STORED_OUTPUT) {
      stdoutBuffer = stdoutBuffer.slice(-MAX_STORED_OUTPUT);
    }
    sendEvent(sdk, "terminal:output", {
      runId,
      data: chunk,
      stream: "stdout",
    });
  });

  child.stderr?.on("data", (data) => {
    const chunk = data.toString();
    stderrBuffer += chunk;
    if (stderrBuffer.length > MAX_STORED_OUTPUT) {
      stderrBuffer = stderrBuffer.slice(-MAX_STORED_OUTPUT);
    }
    sendEvent(sdk, "terminal:output", {
      runId,
      data: chunk,
      stream: "stderr",
    });
  });

  child.on("close", (exitCode: number | null) => {
    const finishedAt = new Date().toISOString();
    const duration =
      new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    const wasKilled = killedRunIds.has(runId);
    killedRunIds.delete(runId);
    activeProcesses.delete(runId);

    updateHistoryEntry(runId, {
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      exitCode: exitCode ?? -1,
      status: wasKilled ? "killed" : "completed",
      finishedAt,
    }).catch((e) => { sdkRef?.console?.error(`[Dispatch] updateHistoryEntry failed: ${e}`); });

    sendEvent(sdk, "terminal:exit", {
      runId,
      exitCode: exitCode ?? -1,
      duration,
    });

    cleanupTempFiles(tempFiles);
    onClose?.();
  });
}

/** Fire-and-forget: inserts history entry asynchronously and spawns immediately. */
export function executeToolCommand(
  sdk: SDK,
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
  }).catch((e) => { sdkRef?.console?.error(`[Dispatch] insertHistoryEntry failed: ${e}`); });

  spawnAndTrack(sdk, runId, resolvedCommand, tempFiles, toolName, requestId, startedAt);
}

/** Async version: awaits insertHistoryEntry before spawning, resolves when child closes. */
export async function executeToolCommandAsync(
  sdk: SDK,
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
  proc.kill("SIGTERM");
  // Fallback to SIGKILL after 5s if process still in map
  setTimeout(() => {
    if (activeProcesses.has(runId)) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process may already be dead
      }
    }
  }, 5000);

  // Do NOT delete from activeProcesses here — let the close handler do it.

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
        // Ignore individual directory errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Start periodic cleanup
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startPeriodicCleanup(): void {
  if (cleanupTimer) return;
  // Run once immediately
  cleanupStaleTempDirs();
  // Then periodically
  cleanupTimer = setInterval(cleanupStaleTempDirs, CLEANUP_INTERVAL_MS);
}

