import { spawn } from "child_process";
import { platform } from "os";
import type { ToolConfig, ToolDetectionResult, ToolDetectionEntry } from "./types";
import { shellEscape } from "./placeholder";

const IS_MAC = platform() === "darwin";
const IS_WINDOWS = platform() === "win32";

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
      const escaped = shellEscape(binary);
      const child = IS_WINDOWS
        ? spawn("where", [binary])
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
  const segments = command.split(/\||&&|;/).map((s) => s.trim()).filter((s) => s.length > 0);

  for (const segment of segments) {
    const binary = extractBinary(segment);
    if (binary.length > 0 && !binaries.includes(binary)) {
      binaries.push(binary);
    }
  }

  return binaries.length > 0 ? binaries : [command.split(/\s/)[0] ?? command];
}

/** Extract the primary binary from a single command segment. */
function extractBinary(segment: string): string {
  const SKIP_PREFIXES = /^(sudo|env|nohup|nice|time|echo|printf)\s+/;
  let s = segment;
  while (SKIP_PREFIXES.test(s)) {
    s = s.replace(SKIP_PREFIXES, "");
  }
  const tokens = s.split(/\s+/);
  for (const token of tokens) {
    if (token.includes("=") && !token.startsWith("-")) continue;
    // Skip placeholder-only tokens
    if (/^%[A-Z]$/.test(token)) continue;
    return token;
  }
  return s.split(/\s/)[0] ?? s;
}

/** Detect all tools, returning per-tool entries with all required binaries. */
export async function detectAllTools(
  tools: ToolConfig[]
): Promise<{ results: ToolDetectionResult[]; byToolId: ToolDetectionEntry[] }> {
  // Collect all unique binaries across all tools
  const allBinaries = new Set<string>();
  const toolBinaryMap = new Map<string, string[]>(); // toolId -> binaries[]

  for (const tool of tools) {
    const binaries = tool.detectionBinary
      ? [tool.detectionBinary]
      : extractAllBinariesFromCommand(tool.command);
    toolBinaryMap.set(tool.id, binaries);
    for (const b of binaries) {
      allBinaries.add(b);
    }
  }

  // Detect all unique binaries in parallel
  const binaryList = Array.from(allBinaries);
  const detections = await Promise.all(
    binaryList.map(async (binary) => {
      try {
        const detection = await detectTool(binary);
        return { binary, ...detection };
      } catch {
        return { binary, installed: false, path: null };
      }
    })
  );

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
