import { spawn } from "child_process";
import { platform } from "os";
import type { ToolConfig, ToolDetectionResult } from "./types";
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
      // Use login shell to get full PATH for which
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

      // Handle spawn errors (e.g., command not found)
      child.on("error", () => {
        done({ installed: false, path: null });
      });

      // Timeout: if which/where takes >3s, assume not found
      setTimeout(() => {
        try { child.kill(); } catch {}
        done({ installed: false, path: null });
      }, 3000);
    } catch {
      // spawn itself threw
      done({ installed: false, path: null });
    }
  });
}

export function extractBinaryFromCommand(command: string): string {
  const parts = command.split(/&&|;/).map((s) => s.trim());
  const lastPart = parts[parts.length - 1] ?? command;

  if (/^(echo|printf)\s/.test(lastPart) && lastPart.includes("|")) {
    const pipeParts = lastPart.split("|").map((s) => s.trim());
    const afterPipe = pipeParts[1] ?? "";
    return extractBinary(afterPipe);
  }

  return extractBinary(lastPart);
}

function extractBinary(segment: string): string {
  const SKIP_PREFIXES = /^(sudo|env|nohup|nice|time)\s+/;
  let s = segment;
  // Strip known prefixes
  while (SKIP_PREFIXES.test(s)) {
    s = s.replace(SKIP_PREFIXES, "");
  }
  // Skip env-style VAR=value assignments
  const tokens = s.split(/\s+/);
  for (const token of tokens) {
    if (token.includes("=") && !token.startsWith("-")) continue;
    return token;
  }
  return s.split(/\s/)[0] ?? s;
}

export async function detectAllTools(
  tools: ToolConfig[]
): Promise<ToolDetectionResult[]> {
  const binaryMap = new Map<string, string[]>();

  for (const tool of tools) {
    const binary =
      tool.detectionBinary ?? extractBinaryFromCommand(tool.command);
    if (!binaryMap.has(binary)) {
      binaryMap.set(binary, []);
    }
    binaryMap.get(binary)!.push(tool.id);
  }

  const binaries = Array.from(binaryMap.keys());
  const results = await Promise.all(
    binaries.map(async (binary) => {
      try {
        const detection = await detectTool(binary);
        return { binary, ...detection };
      } catch {
        return { binary, installed: false, path: null };
      }
    })
  );
  return results;
}
