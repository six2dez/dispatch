import type { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import type {
  ToolConfig,
  RunEntry,
  PlaceholderPreview,
  ToolDetectionResult,
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
import { executeToolCommand, executeToolCommandAsync, killActiveProcess, startPeriodicCleanup, setExecutorSdk } from "./executor";
import { detectAllTools } from "./detector";
import { rmSync } from "fs";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Store temp files from previews for cleanup (with timestamp for TTL)
const PREVIEW_TTL_MS = 5 * 60 * 1000; // 5 minutes
const previewTempFiles = new Map<string, { tempFiles: string[]; timestamp: number }>();

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
      const t = raw as any;
      if (typeof t?.id !== 'string' || typeof t?.name !== 'string' || typeof t?.command !== 'string') continue;
      await insertTool({ id: t.id, name: t.name, command: t.command, group: t.group ?? '', showPreview: t.showPreview ?? true, enabled: t.enabled ?? true, sortOrder: t.sortOrder ?? 999, detectionBinary: t.detectionBinary });
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
  // Clean stale preview entries (older than 5 min)
  const now = Date.now();
  for (const [key, entry] of previewTempFiles) {
    if (now - entry.timestamp > PREVIEW_TTL_MS) {
      for (const f of entry.tempFiles) {
        try { rmSync(f); } catch { /* ignore */ }
      }
      previewTempFiles.delete(key);
    }
  }

  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);

  const data = await extractRequestData(sdk, requestId);
  const { command, tempFiles } = resolvePlaceholders(tool.command, data);
  const placeholders = buildPlaceholderInfo(tool.command, data);

  const key = `${requestId}:${toolId}`;
  previewTempFiles.set(key, { tempFiles, timestamp: now });

  return { resolvedCommand: command, template: tool.command, placeholders };
}

async function executeCommand(
  sdk: SDK,
  requestId: string,
  toolId: string,
  editedCmd?: string
): Promise<string> {
  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);

  const runId = generateId();
  const previewKey = `${requestId}:${toolId}`;

  if (editedCmd) {
    const entry = previewTempFiles.get(previewKey);
    const tempFiles = entry?.tempFiles ?? [];
    previewTempFiles.delete(previewKey);
    executeToolCommand(
      sdk, runId, editedCmd, tempFiles,
      tool.id, tool.name, requestId, null
    );
  } else {
    previewTempFiles.delete(previewKey);
    const data = await extractRequestData(sdk, requestId);
    const { command, tempFiles } = resolvePlaceholders(tool.command, data);
    executeToolCommand(
      sdk, runId, command, tempFiles,
      tool.id, tool.name, requestId, null
    );
  }

  return runId;
}

async function executeBatch(
  sdk: SDK,
  requestIds: string[],
  toolId: string,
  editedCmd?: string
): Promise<string[]> {
  const tool = await getToolById(toolId);
  if (!tool) throw new Error(`Tool ${toolId} not found`);

  const batchId = generateId();
  const runIds = requestIds.map(() => generateId());

  // Background sequential chain — RPC returns immediately
  (async () => {
    for (let i = 0; i < requestIds.length; i++) {
      const data = await extractRequestData(sdk, requestIds[i]!);
      const template = editedCmd ?? tool.command;
      const { command, tempFiles } = resolvePlaceholders(template, data);
      await executeToolCommandAsync(
        sdk, runIds[i]!, command, tempFiles,
        tool.id, tool.name, requestIds[i]!, batchId
      );
    }
  })().catch((e) => { sdk.console.error(`[Dispatch] batch failed: ${e}`); });

  return runIds;
}

async function executeCustom(
  sdk: SDK,
  requestId: string,
  command: string
): Promise<string> {
  const runId = generateId();
  const data = await extractRequestData(sdk, requestId);
  const { command: resolved, tempFiles } = resolvePlaceholders(command, data);
  executeToolCommand(
    sdk, runId, resolved, tempFiles,
    "custom", "Custom command", requestId, null
  );
  return runId;
}

function killProcess(_sdk: SDK, runId: string): boolean {
  return killActiveProcess(runId);
}

// --- History ---

async function getHistory(
  _sdk: SDK,
  limit?: number
): Promise<RunEntry[]> {
  return getHistoryEntries(limit);
}

async function getRunOutput(
  _sdk: SDK,
  runId: string
): Promise<{ stdout: string; stderr: string }> {
  return getRunOutputById(runId);
}

async function clearHistory(_sdk: SDK): Promise<void> {
  await clearAllHistory();
}

// --- Detection ---

async function detectTools(sdk: SDK): Promise<ToolDetectionResult[]> {
  try {
    const tools = await getAllTools();
    return await detectAllTools(tools);
  } catch (err) {
    sdk.console.error(`[Dispatch] detectTools: ${err}`);
    return [];
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
} from "./types";

// --- Init (SYNCHRONOUS — DB initializes lazily on first API call) ---

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

  sdk.console.log("[Dispatch] Plugin initialized");

  startPeriodicCleanup();
}
