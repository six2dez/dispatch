import type { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import type {
  ToolConfig,
  RunEntry,
  PlaceholderPreview,
  ToolDetectionResult,
  ToolDetectionEntry,
  BatchProgressEvent,
  TerminalOutputEvent,
  TerminalExitEvent,
} from "./types";
import {
  setSdkRef,
  getAllTools,
  getToolById,
  insertTool,
  deleteToolById,
  updateToolOrder,
  deleteAllTools,
  getHistoryEntries,
  getRunOutputById,
  clearAllHistory,
} from "./db";
import { DEFAULT_PRESETS } from "./presets";
import { resolvePlaceholders, buildPlaceholderInfo } from "./placeholder";
import { extractRequestData } from "./request-data";
import {
  executeToolCommand,
  executeToolCommandAsync,
  getMaxConcurrent,
  killActiveProcess,
  releaseSlot,
  reserveSlot,
  setExecutorSdk,
  startPeriodicCleanup,
} from "./executor";
import { detectAllTools } from "./detector";
import { rmSync } from "fs";
import { dirname } from "path";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Store temp files from previews for cleanup (with timestamp for TTL)
const PREVIEW_TTL_MS = 5 * 60 * 1000;
const previewTempFiles = new Map<string, { tempFiles: string[]; timestamp: number }>();

function reserveSlotOrThrow(runId: string): void {
  if (!reserveSlot(runId)) {
    throw new Error(`Max concurrent processes (${getMaxConcurrent()}) reached`);
  }
}

function toRunnerTimeout(tool: { timeoutMs?: number }): number | null {
  return typeof tool.timeoutMs === "number" && tool.timeoutMs > 0 ? tool.timeoutMs : null;
}

function cleanupPreviewTempFiles(tempFiles: string[]): void {
  if (tempFiles.length === 0) return;
  try {
    rmSync(dirname(tempFiles[0]!), { recursive: true, force: true });
  } catch {
    // Ignore preview temp cleanup errors and let TTL cleanup try again later if needed.
  }
}

// --- Tools CRUD ---

async function getTools(sdk: SDK): Promise<ToolConfig[]> {
  try {
    return await getAllTools();
  } catch (err) {
    sdk.console.error(`[Dispatch] getTools: ${err}`);
    throw err;
  }
}

async function saveTool(sdk: SDK, tool: ToolConfig): Promise<void> {
  try {
    await insertTool(tool);
  } catch (err) {
    sdk.console.error(`[Dispatch] saveTool: ${err}`);
    throw err;
  }
}

async function deleteTool(sdk: SDK, id: string): Promise<void> {
  try {
    await deleteToolById(id);
  } catch (err) {
    sdk.console.error(`[Dispatch] deleteTool: ${err}`);
    throw err;
  }
}

async function reorderTools(sdk: SDK, ids: string[]): Promise<void> {
  try {
    await updateToolOrder(ids);
  } catch (err) {
    sdk.console.error(`[Dispatch] reorderTools: ${err}`);
    throw err;
  }
}

async function resetToDefaults(sdk: SDK): Promise<void> {
  try {
    await deleteAllTools();
    for (const preset of DEFAULT_PRESETS) {
      await insertTool(preset);
    }
  } catch (err) {
    sdk.console.error(`[Dispatch] resetToDefaults: ${err}`);
    throw err;
  }
}

async function importTools(
  sdk: SDK,
  json: string
): Promise<{ imported: number }> {
  try {
    const tools: unknown[] = JSON.parse(json);
    let imported = 0;
    for (const raw of tools) {
      const t = raw as Record<string, unknown>;
      if (typeof t?.id !== "string" || typeof t?.name !== "string" || typeof t?.command !== "string") continue;
      // Generate new ID on import to prevent overwriting existing tools
      const newId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await insertTool({
        id: newId,
        name: t.name,
        command: t.command,
        group: typeof t.group === "string" ? t.group : "",
        showPreview: typeof t.showPreview === "boolean" ? t.showPreview : true,
        enabled: typeof t.enabled === "boolean" ? t.enabled : true,
        sortOrder: typeof t.sortOrder === "number" ? t.sortOrder : 999,
        detectionBinary: typeof t.detectionBinary === "string" ? t.detectionBinary : undefined,
        timeoutMs: typeof t.timeoutMs === "number" && t.timeoutMs > 0 ? t.timeoutMs : undefined,
      });
      imported++;
    }
    return { imported };
  } catch (err) {
    sdk.console.error(`[Dispatch] importTools: ${err}`);
    throw err;
  }
}

async function exportTools(sdk: SDK): Promise<string> {
  try {
    const tools = await getAllTools();
    return JSON.stringify(tools, null, 2);
  } catch (err) {
    sdk.console.error(`[Dispatch] exportTools: ${err}`);
    throw err;
  }
}

// --- Execution ---

async function resolvePreview(
  sdk: SDK,
  requestId: string,
  toolId: string
): Promise<PlaceholderPreview> {
  // Clean stale preview entries (older than TTL)
  const now = Date.now();
  for (const [key, entry] of previewTempFiles) {
    if (now - entry.timestamp > PREVIEW_TTL_MS) {
      cleanupPreviewTempFiles(entry.tempFiles);
      previewTempFiles.delete(key);
    }
  }

  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);

  const data = await extractRequestData(sdk, requestId);
  const { command, tempFiles } = resolvePlaceholders(tool.command, data);
  const placeholders = buildPlaceholderInfo(tool.command, data);

  const key = `${requestId}:${toolId}`;
  const existingPreview = previewTempFiles.get(key);
  if (existingPreview) {
    cleanupPreviewTempFiles(existingPreview.tempFiles);
  }
  previewTempFiles.set(key, { tempFiles, timestamp: now });

  return { resolvedCommand: command, template: tool.command, placeholders };
}

async function executeCommand(
  sdk: SDK<API, Events>,
  requestId: string,
  toolId: string,
  editedCmd?: string
): Promise<string> {
  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);

  const runId = generateId();
  reserveSlotOrThrow(runId);
  const timeout = toRunnerTimeout(tool);
  const previewKey = `${requestId}:${toolId}`;

  try {
    if (editedCmd !== undefined) {
      const entry = previewTempFiles.get(previewKey);
      const tempFiles = entry?.tempFiles ?? [];
      previewTempFiles.delete(previewKey);
      executeToolCommand(sdk, runId, editedCmd, tempFiles, tool.id, tool.name, requestId, null, timeout);
    } else {
      previewTempFiles.delete(previewKey);
      const data = await extractRequestData(sdk, requestId);
      const { command, tempFiles } = resolvePlaceholders(tool.command, data);
      executeToolCommand(sdk, runId, command, tempFiles, tool.id, tool.name, requestId, null, timeout);
    }
  } catch (err) {
    releaseSlot(runId);
    throw err;
  }

  return runId;
}

async function executeBatch(
  sdk: SDK<API, Events>,
  requestIds: string[],
  toolId: string,
  editedCmd?: string
): Promise<string[]> {
  const uniqueRequestIds = [...new Set(requestIds)];
  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);
  if (uniqueRequestIds.length === 0) throw new Error("No requests provided");

  const batchId = generateId();
  const runIds = uniqueRequestIds.map(() => generateId());
  const total = uniqueRequestIds.length;
  const timeout = toRunnerTimeout(tool);

  // Reserve the slot for the first iteration synchronously so the RPC caller
  // gets an immediate "max concurrent" error instead of a silent drop later.
  reserveSlotOrThrow(runIds[0]!);

  // Background sequential chain — RPC returns immediately
  (async () => {
    let completed = 0;
    for (let i = 0; i < uniqueRequestIds.length; i++) {
      const requestId = uniqueRequestIds[i]!;
      const runId = runIds[i]!;

      // The first iteration already reserved its slot above; later ones must
      // reserve now (prior run has released its slot by this point).
      if (i > 0 && !reserveSlot(runId)) {
        sdk.console.error(`[Dispatch] batch item ${i} skipped: max concurrent (${getMaxConcurrent()}) reached`);
        completed++;
        continue;
      }

      sdk.api.send("batch:progress", {
        batchId,
        completed,
        total,
        currentRunId: runId,
        currentRequestId: requestId,
        status: "running" as const,
      });

      try {
        const data = await extractRequestData(sdk, requestId);
        const template = editedCmd ?? tool.command;
        const { command, tempFiles } = resolvePlaceholders(template, data);
        await executeToolCommandAsync(sdk, runId, command, tempFiles, tool.id, tool.name, requestId, batchId, timeout);
      } catch (e) {
        // Slot may or may not have been consumed by spawnAndTrack depending on
        // where the throw happened; releaseSlot is idempotent.
        releaseSlot(runId);
        sdk.console.error(`[Dispatch] batch item ${i} failed: ${e}`);
        // Continue with next request instead of breaking the chain
      }
      completed++;
    }

    // Send final progress
    sdk.api.send("batch:progress", {
      batchId,
      completed,
      total,
      currentRunId: runIds[runIds.length - 1]!,
      currentRequestId: uniqueRequestIds[uniqueRequestIds.length - 1]!,
      status: "completed" as const,
    });
  })().catch((e) => {
    sdk.console.error(`[Dispatch] batch failed: ${e}`);
  });

  return runIds;
}

async function executeCustom(
  sdk: SDK<API, Events>,
  requestId: string,
  command: string
): Promise<string> {
  const runId = generateId();
  reserveSlotOrThrow(runId);
  try {
    const data = await extractRequestData(sdk, requestId);
    const { command: resolved, tempFiles } = resolvePlaceholders(command, data);
    executeToolCommand(sdk, runId, resolved, tempFiles, "custom", "Custom command", requestId, null, null);
  } catch (err) {
    releaseSlot(runId);
    throw err;
  }
  return runId;
}

function killProcess(_sdk: SDK, runId: string): boolean {
  return killActiveProcess(runId);
}

// --- History ---

async function getHistory(_sdk: SDK, limit?: number): Promise<RunEntry[]> {
  return getHistoryEntries(limit);
}

async function getRunOutput(_sdk: SDK, runId: string): Promise<{ stdout: string; stderr: string }> {
  return getRunOutputById(runId);
}

async function clearHistory(_sdk: SDK): Promise<void> {
  await clearAllHistory();
}

// --- Findings ---

async function createFinding(
  sdk: SDK,
  requestId: string,
  title: string,
  description: string
): Promise<{ id: string }> {
  const item = await sdk.requests.get(requestId);
  if (!item) throw new Error(`Request ${requestId} not found`);

  const finding = await sdk.findings.create({
    title,
    description,
    reporter: "Dispatch",
    request: item.request,
  });
  return { id: String(finding.getId()) };
}

// --- Detection ---

async function detectTools(sdk: SDK): Promise<{
  results: ToolDetectionResult[];
  byToolId: ToolDetectionEntry[];
}> {
  try {
    const tools = await getAllTools();
    return await detectAllTools(tools);
  } catch (err) {
    sdk.console.error(`[Dispatch] detectTools: ${err}`);
    return { results: [], byToolId: [] };
  }
}

// --- Event Types ---

type Events = DefineEvents<{
  "terminal:start": (data: {
    runId: string;
    toolName: string;
    resolvedCommand: string;
    requestId: string | null;
    startedAt: string;
  }) => void;
  "terminal:output": (data: TerminalOutputEvent) => void;
  "terminal:exit": (data: TerminalExitEvent) => void;
  "batch:progress": (data: BatchProgressEvent) => void;
}>;

// --- API Type ---

export type API = DefineAPI<{
  getTools: typeof getTools;
  saveTool: typeof saveTool;
  deleteTool: typeof deleteTool;
  reorderTools: typeof reorderTools;
  resetToDefaults: typeof resetToDefaults;
  importTools: typeof importTools;
  exportTools: typeof exportTools;
  resolvePreview: typeof resolvePreview;
  executeCommand: typeof executeCommand;
  executeBatch: typeof executeBatch;
  executeCustom: typeof executeCustom;
  killProcess: typeof killProcess;
  getHistory: typeof getHistory;
  getRunOutput: typeof getRunOutput;
  clearHistory: typeof clearHistory;
  detectTools: typeof detectTools;
  createFinding: typeof createFinding;
}>;

// --- Re-export types for frontend ---

export type { Events };
export type {
  ToolConfig,
  RunEntry,
  PlaceholderPreview,
  TerminalOutputEvent,
  TerminalExitEvent,
  ToolDetectionResult,
  ToolDetectionEntry,
  BatchProgressEvent,
} from "./types";

// --- Init ---

export function init(sdk: SDK<API, Events>) {
  setSdkRef(sdk);
  setExecutorSdk(sdk);

  sdk.console.log("[Dispatch] Registering API functions...");

  sdk.api.register("getTools", getTools);
  sdk.api.register("saveTool", saveTool);
  sdk.api.register("deleteTool", deleteTool);
  sdk.api.register("reorderTools", reorderTools);
  sdk.api.register("resetToDefaults", resetToDefaults);
  sdk.api.register("importTools", importTools);
  sdk.api.register("exportTools", exportTools);
  sdk.api.register("resolvePreview", resolvePreview);
  sdk.api.register("executeCommand", executeCommand);
  sdk.api.register("executeBatch", executeBatch);
  sdk.api.register("executeCustom", executeCustom);
  sdk.api.register("killProcess", killProcess);
  sdk.api.register("getHistory", getHistory);
  sdk.api.register("getRunOutput", getRunOutput);
  sdk.api.register("clearHistory", clearHistory);
  sdk.api.register("detectTools", detectTools);
  sdk.api.register("createFinding", createFinding);

  sdk.console.log("[Dispatch] Plugin initialized");
  startPeriodicCleanup();
}
