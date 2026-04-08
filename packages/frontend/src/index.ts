import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import type { CaidoSDK } from "./types";
import App from "./App.vue";
import { sdkKey } from "./composables/useSdk";
import { useTerminal } from "./composables/useTerminal";
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

  // Register per-tool quick dispatch commands
  sdk.backend.getTools().then((tools) => {
    for (const tool of tools) {
      if (!tool.enabled) continue;

      const cmdId = `dispatch-tool-${tool.id}`;

      sdk.commands.register(cmdId, {
        name: `Dispatch: ${tool.name}`,
        run: (context) => {
          const requestIds = extractRequestIds(context as Record<string, unknown>);
          if (requestIds.length === 0) {
            sdk.window.showToast("No request ID found in context", { variant: "warning", duration: 3000 });
            return;
          }
          appInstance.dispatchTool(tool, requestIds);
        },
        group: "Dispatch",
      });

      sdk.menu.registerItem({
        type: "RequestRow",
        commandId: cmdId,
        leadingIcon: "fas fa-terminal",
      });

      sdk.commandPalette.register(cmdId);
    }
  });

  // Terminal event handlers
  const { addRun, appendOutput, finishRun } = useTerminal();

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

  sdk.backend.onEvent("terminal:exit", (event) => {
    const e = event as { runId: string; exitCode: number; duration: number };
    finishRun(e.runId, e.exitCode, e.duration);
  });
};
