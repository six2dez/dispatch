import { computed, shallowRef } from "vue";
import type { ToolConfig } from "dispatch-backend";
import type { CaidoSDK } from "../types";

const toolCatalog = shallowRef<ToolConfig[]>([]);
let refreshRequestId = 0;

export function useToolCatalog() {
  const enabledTools = computed(() => toolCatalog.value.filter((tool) => tool.enabled));

  function getToolById(toolId: string): ToolConfig | undefined {
    return toolCatalog.value.find((tool) => tool.id === toolId);
  }

  async function refreshToolCatalog(sdk: CaidoSDK): Promise<ToolConfig[]> {
    const requestId = ++refreshRequestId;
    const tools = await sdk.backend.getTools();

    if (requestId === refreshRequestId) {
      toolCatalog.value = tools;
    }

    return requestId === refreshRequestId ? tools : toolCatalog.value;
  }

  return {
    toolCatalog,
    enabledTools,
    getToolById,
    refreshToolCatalog,
  };
}
