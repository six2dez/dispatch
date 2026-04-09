import { ref } from "vue";
import type { ToolDetectionEntry } from "dispatch-backend";
import type { CaidoSDK } from "../types";

const detectionByToolId = ref<Map<string, ToolDetectionEntry>>(new Map());
let lastDetectionTime = 0;
let detectionRequestId = 0;

export function useDetection() {
  function setDetectionResults(entries: ToolDetectionEntry[]): void {
    const map = new Map<string, ToolDetectionEntry>();
    for (const entry of entries) {
      map.set(entry.toolId, entry);
    }
    detectionByToolId.value = map;
    lastDetectionTime = Date.now();
  }

  function isToolInstalled(toolId: string): boolean | undefined {
    if (detectionByToolId.value.size === 0) return undefined;
    const entry = detectionByToolId.value.get(toolId);
    return entry?.installed;
  }

  function getMissingBinaries(toolId: string): string[] {
    const entry = detectionByToolId.value.get(toolId);
    return entry?.missingBinaries ?? [];
  }

  function shouldRefresh(): boolean {
    return Date.now() - lastDetectionTime > 60000;
  }

  function invalidateDetection(): void {
    detectionRequestId++;
    detectionByToolId.value = new Map();
    lastDetectionTime = 0;
  }

  async function refreshDetection(
    sdk: CaidoSDK,
    force = false
  ): Promise<ToolDetectionEntry[]> {
    if (!force && !shouldRefresh() && detectionByToolId.value.size > 0) {
      return Array.from(detectionByToolId.value.values());
    }

    const requestId = ++detectionRequestId;
    const detection = await sdk.backend.detectTools();

    if (requestId === detectionRequestId) {
      setDetectionResults(detection.byToolId);
      return detection.byToolId;
    }

    return Array.from(detectionByToolId.value.values());
  }

  return {
    refreshDetection,
    invalidateDetection,
    isToolInstalled,
    getMissingBinaries,
    shouldRefresh,
  };
}
