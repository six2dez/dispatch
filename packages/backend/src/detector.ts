import { spawn } from "child_process";
import { platform } from "os";
import type { ToolConfig, ToolDetectionResult, ToolDetectionEntry } from "./types";
import { shellEscape } from "./placeholder";

const IS_MAC = platform() === "darwin";
const IS_WINDOWS = platform() === "win32";
const DETECTION_CONCURRENCY = 5;
const SHELL_HELPERS = new Set(["sudo", "env", "nohup", "nice", "time", "echo", "printf"]);
const PLACEHOLDER_TOKEN = /^%[A-Z]$/;
const ENV_ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=.*/;
const ENV_REFERENCE_TOKEN = /^\$(\{?[A-Za-z_][A-Za-z0-9_]*\}?)$/;

function normalizeBinaryToken(token: string): string {
  return token.trim().replace(/^['"]+|['"]+$/g, "");
}

export function detectTool(
  binary: string
): Promise<{ installed: boolean; path: string | null }> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: { installed: boolean; path: string | null }) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    try {
      let output = "";
      const normalizedBinary = normalizeBinaryToken(binary);
      if (normalizedBinary.length === 0) {
        done({ installed: false, path: null });
        return;
      }
      const escaped = shellEscape(normalizedBinary);
      const child = IS_WINDOWS
        ? spawn("where", [normalizedBinary])
        : IS_MAC
          ? spawn("/bin/zsh", ["-lc", `which -- ${escaped}`])
          : spawn("/bin/bash", ["-lc", `which -- ${escaped}`]);

      child.stdout.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code: number | null) => {
        done({
          installed: code === 0,
          path: code === 0 ? output.trim().split("\n")[0]! : null,
        });
      });

      child.on("error", () => {
        done({ installed: false, path: null });
      });

      setTimeout(() => {
        try { child.kill(); } catch { /* already dead */ }
        done({ installed: false, path: null });
      }, 3000);
    } catch {
      done({ installed: false, path: null });
    }
  });
}

/** Extract ALL binaries from a command (handles pipes, &&, ;). */
export function extractAllBinariesFromCommand(command: string): string[] {
  const binaries: string[] = [];
  // Split on pipes, &&, and ;
  const segments = command.split(/\|\||&&|[|;]/).map((s) => s.trim()).filter((s) => s.length > 0);

  for (const segment of segments) {
    const binary = extractBinary(segment);
    if (binary !== null && !binaries.includes(binary)) {
      binaries.push(binary);
    }
  }

  return binaries;
}

/** Extract the primary binary from a single command segment. */
function extractBinary(segment: string): string | null {
  let tokens = segment.split(/\s+/).map(normalizeBinaryToken).filter((token) => token.length > 0);

  while (tokens.length > 0 && SHELL_HELPERS.has(tokens[0]!)) {
    tokens = tokens.slice(1);
  }

  for (const token of tokens) {
    if (ENV_ASSIGNMENT_TOKEN.test(token)) continue;
    if (PLACEHOLDER_TOKEN.test(token)) continue;
    if (ENV_REFERENCE_TOKEN.test(token)) continue;
    return token;
  }

  return null;
}

function getToolBinaries(tool: ToolConfig): string[] {
  const extracted = extractAllBinariesFromCommand(tool.command);
  const detected = tool.detectionBinary
    ? [normalizeBinaryToken(tool.detectionBinary), ...extracted.slice(1)]
    : extracted;

  return detected.filter((binary, index) => binary.length > 0 && detected.indexOf(binary) === index);
}

async function detectBinaries(binaryList: string[]): Promise<ToolDetectionResult[]> {
  const detections: ToolDetectionResult[] = [];

  for (let i = 0; i < binaryList.length; i += DETECTION_CONCURRENCY) {
    const batch = binaryList.slice(i, i + DETECTION_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (binary) => {
        try {
          const detection = await detectTool(binary);
          return { binary, ...detection };
        } catch {
          return { binary, installed: false, path: null };
        }
      })
    );
    detections.push(...batchResults);
  }

  return detections;
}

/** Detect all tools, returning per-tool entries with all required binaries. */
export async function detectAllTools(
  tools: ToolConfig[]
): Promise<{ results: ToolDetectionResult[]; byToolId: ToolDetectionEntry[] }> {
  // Collect all unique binaries across all tools
  const allBinaries = new Set<string>();
  const toolBinaryMap = new Map<string, string[]>(); // toolId -> binaries[]

  for (const tool of tools) {
    const binaries = getToolBinaries(tool);
    toolBinaryMap.set(tool.id, binaries);
    for (const b of binaries) {
      allBinaries.add(b);
    }
  }

  // Detect all unique binaries in parallel
  const binaryList = Array.from(allBinaries);
  const detections = await detectBinaries(binaryList);

  const detectionMap = new Map<string, ToolDetectionResult>();
  for (const det of detections) {
    detectionMap.set(det.binary, det);
  }

  // Build per-tool entries — a tool is "installed" only if ALL its binaries are found
  const byToolId: ToolDetectionEntry[] = [];
  for (const tool of tools) {
    const binaries = toolBinaryMap.get(tool.id) ?? [];
    const missingBinaries: string[] = [];

    for (const b of binaries) {
      const det = detectionMap.get(b);
      if (!det || !det.installed) {
        missingBinaries.push(b);
      }
    }

    const allInstalled = missingBinaries.length === 0;
    const primaryBinary = binaries[0] ?? "";
    const primaryDet = detectionMap.get(primaryBinary);

    byToolId.push({
      toolId: tool.id,
      binary: primaryBinary,
      installed: allInstalled,
      path: primaryDet?.path ?? null,
      missingBinaries: missingBinaries.length > 0 ? missingBinaries : undefined,
    });
  }

  return { results: detections, byToolId };
}
