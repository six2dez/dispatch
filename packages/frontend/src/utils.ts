import type { ToolConfig } from "dispatch-backend";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

export function groupToolsByCategory(
  tools: ToolConfig[]
): Map<string, ToolConfig[]> {
  const groups = new Map<string, ToolConfig[]>();
  for (const tool of tools) {
    const group = tool.group || "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(tool);
  }
  return groups;
}

export function addModalDismissHandlers(overlay: HTMLElement): void {
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
