import type { ToolConfig, ToolDetectionResult } from "dispatch-backend";

let detectionCache = new Map<string, ToolDetectionResult>();

export function setDetectionCache(results: ToolDetectionResult[]): void {
  const map = new Map<string, ToolDetectionResult>();
  for (const r of results) {
    map.set(r.binary, r);
  }
  detectionCache = map;
}

export function isToolInstalled(tool: ToolConfig): boolean | null {
  if (detectionCache.size === 0) return null;
  const binary =
    tool.detectionBinary ?? (tool.command.split(/\s/)[0] ?? tool.command);
  const result = detectionCache.get(binary);
  return result ? result.installed : null;
}
