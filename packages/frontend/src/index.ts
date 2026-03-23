import type { CaidoSDK } from "./types";

import { createDispatchPage } from "./pages/DispatchPage";
import { openToolPicker } from "./components/ToolPicker";
import { addRun, appendOutput, finishRun } from "./components/Terminal";

import "./styles/index.css";

const Page = "/dispatch" as const;

export const init = (sdk: CaidoSDK) => {
  // Store SDK reference for components that need it (e.g., kill button)
  (window as any).__dispatchSdk = sdk;

  // Register the single "Dispatch..." command
  sdk.commands.register("dispatch-open", {
    name: "Dispatch...",
    run: (context) => {
      try {
        const requestIds: string[] = [];

        // RequestRowContext: right-click on request row(s) in table
        if ("requests" in context && Array.isArray(context.requests)) {
          for (const r of context.requests) {
            if (r.id) requestIds.push(String(r.id));
          }
        }

        // RequestContext: right-click on request pane (no ID, but has raw)
        if ("request" in context && context.request) {
          const req = context.request as any;
          if (req.id) {
            requestIds.push(String(req.id));
          }
        }

        if (requestIds.length === 0) {
          sdk.window.showToast("No request ID found in context", {
            variant: "warning",
            duration: 3000,
          });
          return;
        }

        openToolPicker(sdk, requestIds);
      } catch (err) {
        sdk.window.showToast(`Dispatch error: ${err}`, {
          variant: "error",
          duration: 5000,
        });
      }
    },
    group: "Dispatch",
  });

  // Register context menu items
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

  // Register command palette entry
  sdk.commandPalette.register("dispatch-open");

  // Create and register the Dispatch page
  const page = createDispatchPage(sdk);
  sdk.navigation.addPage(Page, { body: page });

  // Register sidebar item
  sdk.sidebar.registerItem("Dispatch", Page, {
    icon: "fas fa-terminal",
  });

  // Listen for terminal events from backend
  sdk.backend.onEvent("terminal:start", (event: any) => {
    addRun({
      runId: event.runId,
      toolName: event.toolName,
      resolvedCommand: event.resolvedCommand,
      requestId: event.requestId ?? null,
      startedAt: event.startedAt,
    });
  });

  sdk.backend.onEvent("terminal:output", (event: any) => {
    appendOutput(event.runId, event.data, event.stream);
  });

  sdk.backend.onEvent("terminal:exit", (event: any) => {
    finishRun(event.runId, event.exitCode, event.duration);
  });
};
