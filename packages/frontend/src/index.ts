import { createApp, watch } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import type { ToolConfig } from "dispatch-backend";
import type { CaidoSDK } from "./types";
import App from "./App.vue";
import { sdkKey } from "./composables/useSdk";
import { useTerminal } from "./composables/useTerminal";
import { useToolCatalog } from "./composables/useToolCatalog";
import { getErrorMessage } from "./utils/errors";
import "./styles/index.css";

const Page = "/dispatch" as const;

// Extract request IDs from any command context
function extractRequestIds(context: Record<string, unknown>): string[] {
  const ids: string[] = [];

  if ("requests" in context && Array.isArray(context.requests)) {
    for (const r of context.requests) {
      if (r.id) ids.push(String(r.id));
    }
  }

  if ("request" in context && context.request) {
    const req = context.request as Record<string, unknown>;
    if (req.id) ids.push(String(req.id));
  }

  return ids;
}

export const init = (sdk: CaidoSDK) => {
  const { toolCatalog, getToolById, refreshToolCatalog } = useToolCatalog();
  const { addRun, appendOutput, updateBatchProgress, finishRun } = useTerminal();
  const registeredQuickDispatchCommands = new Set<string>();
  const root = document.createElement("div");
  root.style.height = "100%";
  root.classList.add("p-dark");
  // PrimeVue needs .p-dark on <html> for global components (Dialog, Select overlay)
  document.documentElement.classList.add("p-dark");

  const app = createApp(App);

  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: ".p-dark",
        cssLayer: false,
      },
    },
  });

  app.provide(sdkKey, sdk);

  const vm = app.mount(root);
  const appInstance = vm as InstanceType<typeof App>;

  // Register the Dispatch page
  sdk.navigation.addPage(Page, { body: root });

  sdk.sidebar.registerItem("Dispatch", Page, {
    icon: "fas fa-terminal",
  });

  // Main "Dispatch..." command — opens the picker
  sdk.commands.register("dispatch-open", {
    name: "Dispatch...",
    run: (context) => {
      const requestIds = extractRequestIds(context as Record<string, unknown>);
      if (requestIds.length === 0) {
        sdk.window.showToast("No request ID found in context", { variant: "warning", duration: 3000 });
        return;
      }
      appInstance.openPicker(requestIds);
    },
    group: "Dispatch",
  });

  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: "dispatch-open",
    leadingIcon: "fas fa-terminal",
  });

  sdk.menu.registerItem({
    type: "Request",
    commandId: "dispatch-open",
    leadingIcon: "fas fa-terminal",
  });

  sdk.commandPalette.register("dispatch-open");

  function isQuickDispatchAvailable(toolId: string, context: Record<string, unknown>): boolean {
    return extractRequestIds(context).length > 0 && Boolean(getToolById(toolId)?.enabled);
  }

  function runQuickDispatch(toolId: string, context: Record<string, unknown>): void {
    const requestIds = extractRequestIds(context);
    if (requestIds.length === 0) {
      sdk.window.showToast("No request ID found in context", { variant: "warning", duration: 3000 });
      return;
    }

    const tool = getToolById(toolId);
    if (!tool || !tool.enabled) {
      sdk.window.showToast("This tool is no longer available. Refresh the settings and try again.", {
        variant: "warning",
        duration: 4000,
      });
      return;
    }

    appInstance.dispatchTool(tool, requestIds);
  }

  function syncQuickDispatchCommands(tools: readonly ToolConfig[]): void {
    for (const tool of tools) {
      const cmdId = `dispatch-tool-${tool.id}`;

      sdk.commands.register(cmdId, {
        name: `Dispatch: ${tool.name}`,
        run: (context) => runQuickDispatch(tool.id, context as Record<string, unknown>),
        group: "Dispatch",
        when: (context) => isQuickDispatchAvailable(tool.id, context as Record<string, unknown>),
      });

      if (registeredQuickDispatchCommands.has(cmdId)) {
        continue;
      }

      sdk.menu.registerItem({
        type: "RequestRow",
        commandId: cmdId,
        leadingIcon: "fas fa-terminal",
      });

      sdk.commandPalette.register(cmdId);
      registeredQuickDispatchCommands.add(cmdId);
    }
  }

  watch(toolCatalog, (tools) => {
    syncQuickDispatchCommands(tools);
  }, { immediate: true });

  void refreshToolCatalog(sdk).catch((err: unknown) => {
    sdk.window.showToast(`Failed to load tools: ${getErrorMessage(err, "Could not load tools")}`, {
      variant: "error",
      duration: 5000,
    });
  });

  // Terminal event handlers
  sdk.backend.onEvent("terminal:start", (event) => {
    const e = event as {
      runId: string;
      toolName: string;
      resolvedCommand: string;
      requestId: string | null;
      startedAt: string;
    };
    addRun({
      runId: e.runId,
      toolName: e.toolName,
      resolvedCommand: e.resolvedCommand,
      requestId: e.requestId,
      startedAt: e.startedAt,
    });
  });

  sdk.backend.onEvent("terminal:output", (event) => {
    const e = event as { runId: string; data: string; stream: "stdout" | "stderr" };
    appendOutput(e.runId, e.data, e.stream);
  });

  sdk.backend.onEvent("batch:progress", (event) => {
    updateBatchProgress(event as {
      batchId: string;
      completed: number;
      total: number;
      currentRunId: string;
      currentRequestId: string;
      status: "running" | "completed" | "failed";
    });
  });

  sdk.backend.onEvent("terminal:exit", (event) => {
    const e = event as { runId: string; exitCode: number; duration: number };
    finishRun(e.runId, e.exitCode, e.duration);
  });
};
