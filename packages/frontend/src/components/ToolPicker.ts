import type { CaidoSDK } from "../types";
import type { ToolConfig } from "dispatch-backend";
import { openPreviewDialog } from "./PreviewDialog";
import { setDetectionCache, isToolInstalled } from "./detection";
import { groupToolsByCategory, addModalDismissHandlers } from "../utils";

let lastDetectionTime = 0;

export function openToolPicker(
  sdk: CaidoSDK,
  requestIds: string[]
): void {
  const overlay = document.createElement("div");
  overlay.className = "dispatch-picker-overlay";

  const modal = document.createElement("div");
  modal.className = "dispatch-picker-modal";

  // Multi-select indicator
  if (requestIds.length > 1) {
    const countDiv = document.createElement("div");
    countDiv.className = "dispatch-picker-count";
    countDiv.textContent = `${requestIds.length} requests selected`;
    modal.appendChild(countDiv);
  }

  // Search input
  const search = document.createElement("input");
  search.className = "dispatch-picker-search";
  search.type = "text";
  search.placeholder = "Search tools...";
  modal.appendChild(search);

  // Tool list
  const list = document.createElement("div");
  list.className = "dispatch-picker-list";
  modal.appendChild(list);

  // Custom command option
  const customBtn = document.createElement("div");
  customBtn.className = "dispatch-picker-custom";
  customBtn.textContent = "Custom command...";
  modal.appendChild(customBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let tools: ToolConfig[] = [];
  let selectedIndex = 0;
  let visibleItems: HTMLElement[] = [];

  // Load tools
  sdk.backend.getTools().then((allTools) => {
    tools = allTools.filter((t) => t.enabled);
    renderList("");

    // Also trigger detection in background (with TTL)
    if (Date.now() - lastDetectionTime > 60000) {
      sdk.backend.detectTools().then((results) => {
        lastDetectionTime = Date.now();
        setDetectionCache(results);
        renderList(search.value);
      });
    }
  });

  function renderList(filter: string): void {
    list.innerHTML = "";
    visibleItems = [];
    selectedIndex = 0;

    const filterLower = filter.toLowerCase();
    const filtered = tools.filter(
      (t) =>
        t.name.toLowerCase().includes(filterLower) ||
        t.group.toLowerCase().includes(filterLower)
    );

    const groups = groupToolsByCategory(filtered);

    for (const [groupName, groupTools] of groups) {
      const header = document.createElement("div");
      header.className = "dispatch-picker-group-header";
      header.textContent = groupName;
      list.appendChild(header);

      for (const tool of groupTools) {
        const item = document.createElement("div");
        item.className = "dispatch-picker-item";

        const name = document.createElement("span");
        name.className = "dispatch-picker-item-name";
        name.textContent = tool.name;
        item.appendChild(name);

        const installed = isToolInstalled(tool);
        if (installed !== null) {
          const status = document.createElement("span");
          status.className = `dispatch-picker-item-status ${installed ? "dispatch-picker-item-installed" : "dispatch-picker-item-missing"}`;
          status.textContent = installed ? "\u2713" : "\u2717";
          item.appendChild(status);
        }

        item.addEventListener("click", () => {
          overlay.remove();
          handleToolSelected(sdk, tool, requestIds);
        });

        list.appendChild(item);
        visibleItems.push(item);
      }
    }

    if (visibleItems.length === 0 && filter.length > 0) {
      const empty = document.createElement("div");
      empty.style.padding = "12px 14px";
      empty.style.color = "var(--c-fg-subtle, #666)";
      empty.style.fontStyle = "italic";
      empty.style.fontSize = "13px";
      empty.textContent = "No tools match your search.";
      list.appendChild(empty);
    }

    if (visibleItems.length > 0) {
      visibleItems[0]!.classList.add("selected");
    }
  }

  // Search filtering with debounce
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener("input", () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderList(search.value), 150);
  });

  // Keyboard navigation
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (visibleItems.length === 0) return;
      visibleItems[selectedIndex]?.classList.remove("selected");
      selectedIndex = (selectedIndex + 1) % visibleItems.length;
      visibleItems[selectedIndex]?.classList.add("selected");
      visibleItems[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleItems.length === 0) return;
      visibleItems[selectedIndex]?.classList.remove("selected");
      selectedIndex =
        (selectedIndex - 1 + visibleItems.length) % visibleItems.length;
      visibleItems[selectedIndex]?.classList.add("selected");
      visibleItems[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const selectedEl = visibleItems[selectedIndex];
      if (selectedEl) selectedEl.click();
    }
  });

  addModalDismissHandlers(overlay);

  // Custom command handler
  customBtn.addEventListener("click", () => {
    overlay.remove();
    openCustomCommandInput(sdk, requestIds);
  });

  // Focus search
  setTimeout(() => search.focus(), 0);
}

function handleToolSelected(
  sdk: CaidoSDK,
  tool: ToolConfig,
  requestIds: string[]
): void {
  if (tool.showPreview && requestIds.length > 0) {
    const firstRequestId = requestIds[0]!;
    sdk.backend
      .resolvePreview(firstRequestId, tool.id)
      .then((preview) => {
        openPreviewDialog(sdk, preview, tool, requestIds);
      })
      .catch((err: unknown) => {
        sdk.window.showToast(`Preview failed: ${err}`, {
          variant: "error",
          duration: 5000,
        });
      });
  } else {
    executeTool(sdk, tool, requestIds);
  }
}

export function executeTool(
  sdk: CaidoSDK,
  tool: ToolConfig,
  requestIds: string[],
  editedCmd?: string
): void {
  const promise =
    requestIds.length === 1
      ? sdk.backend.executeCommand(requestIds[0]!, tool.id, editedCmd)
      : requestIds.length > 1
        ? sdk.backend.executeBatch(requestIds, tool.id, editedCmd)
        : Promise.resolve(null);

  promise
    .then(() => {
      sdk.navigation.goTo("/dispatch");
    })
    .catch((err: unknown) => {
      sdk.window.showToast(`Execute failed: ${err}`, {
        variant: "error",
        duration: 5000,
      });
    });
}

function openCustomCommandInput(
  sdk: CaidoSDK,
  requestIds: string[]
): void {
  const overlay = document.createElement("div");
  overlay.className = "dispatch-preview-overlay";

  const modal = document.createElement("div");
  modal.className = "dispatch-preview-modal";

  const title = document.createElement("div");
  title.className = "dispatch-preview-title";
  title.textContent = "Custom Command";
  modal.appendChild(title);

  const input = document.createElement("textarea");
  input.className = "dispatch-preview-command";
  input.placeholder = "Enter command template... (use %U, %H, %R, etc.)";
  modal.appendChild(input);

  const actions = document.createElement("div");
  actions.className = "dispatch-preview-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "dispatch-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  const runBtn = document.createElement("button");
  runBtn.className = "dispatch-btn dispatch-btn-primary";
  runBtn.textContent = "Run";
  runBtn.addEventListener("click", () => {
    const cmd = input.value.trim();
    if (!cmd) return;
    overlay.remove();
    (async () => {
      for (const requestId of requestIds) {
        await sdk.backend.executeCustom(requestId, cmd).catch(() => {});
      }
    })();
    sdk.navigation.goTo("/dispatch");
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(runBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  addModalDismissHandlers(overlay);

  setTimeout(() => input.focus(), 0);
}
