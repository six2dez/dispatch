import type { CaidoSDK } from "../types";
import type { ToolConfig } from "dispatch-backend";
import { openToolEditor } from "./ToolEditor";
import { setDetectionCache, isToolInstalled } from "./detection";
import { groupToolsByCategory } from "../utils";

export function createSettingsPanel(sdk: CaidoSDK): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "dispatch-panel dispatch-settings";

  const toolbar = document.createElement("div");
  toolbar.className = "dispatch-settings-toolbar";

  const addBtn = document.createElement("button");
  addBtn.className = "dispatch-btn dispatch-btn-primary";
  addBtn.textContent = "Add Tool";
  addBtn.addEventListener("click", () => {
    openToolEditor(sdk, null, () => refreshToolList(sdk, listContainer));
  });

  const detectBtn = document.createElement("button");
  detectBtn.className = "dispatch-btn";
  detectBtn.textContent = "Detect Tools";
  detectBtn.addEventListener("click", () => {
    detectBtn.textContent = "Detecting...";
    detectBtn.setAttribute("disabled", "true");
    sdk.backend
      .detectTools()
      .then((results) => {
        setDetectionCache(results);
        refreshToolList(sdk, listContainer);
      })
      .catch((err: unknown) => {
        sdk.window.showToast(`Detection failed: ${err}`, { variant: "error" });
      })
      .finally(() => {
        detectBtn.textContent = "Detect Tools";
        detectBtn.removeAttribute("disabled");
      });
  });

  const exportBtn = document.createElement("button");
  exportBtn.className = "dispatch-btn";
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", () => {
    sdk.backend
      .exportTools()
      .then((json) => {
        navigator.clipboard.writeText(json).catch(() => {});
        exportBtn.textContent = "Copied!";
        setTimeout(() => {
          exportBtn.textContent = "Export";
        }, 1500);
      })
      .catch((err: unknown) => sdk.window.showToast(`Export failed: ${err}`, { variant: "error" }));
  });

  const importBtn = document.createElement("button");
  importBtn.className = "dispatch-btn";
  importBtn.textContent = "Import";
  importBtn.addEventListener("click", () => {
    const importOverlay = document.createElement("div");
    importOverlay.className = "dispatch-preview-overlay";

    const importModal = document.createElement("div");
    importModal.className = "dispatch-preview-modal";

    const importTitle = document.createElement("div");
    importTitle.className = "dispatch-preview-title";
    importTitle.textContent = "Import Tools";
    importModal.appendChild(importTitle);

    const importTextarea = document.createElement("textarea");
    importTextarea.className = "dispatch-preview-command";
    importTextarea.placeholder = "Paste exported JSON here...";
    importModal.appendChild(importTextarea);

    const importActions = document.createElement("div");
    importActions.className = "dispatch-preview-actions";

    const importCancelBtn = document.createElement("button");
    importCancelBtn.className = "dispatch-btn";
    importCancelBtn.textContent = "Cancel";
    importCancelBtn.addEventListener("click", () => importOverlay.remove());

    const importConfirmBtn = document.createElement("button");
    importConfirmBtn.className = "dispatch-btn dispatch-btn-primary";
    importConfirmBtn.textContent = "Import";
    importConfirmBtn.addEventListener("click", () => {
      const input = importTextarea.value.trim();
      if (!input) return;
      importOverlay.remove();
      sdk.backend
        .importTools(input)
        .then((result) => {
          sdk.window.showToast(`Imported ${result.imported} tools`, { variant: "success" });
          refreshToolList(sdk, listContainer);
        })
        .catch((err: unknown) => sdk.window.showToast(`Import failed: ${err}`, { variant: "error" }));
    });

    importActions.appendChild(importCancelBtn);
    importActions.appendChild(importConfirmBtn);
    importModal.appendChild(importActions);

    importOverlay.appendChild(importModal);
    document.body.appendChild(importOverlay);

    importOverlay.addEventListener("click", (e) => {
      if (e.target === importOverlay) importOverlay.remove();
    });
    importOverlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") importOverlay.remove();
    });

    setTimeout(() => importTextarea.focus(), 0);
  });

  const resetBtn = document.createElement("button");
  resetBtn.className = "dispatch-btn dispatch-btn-danger";
  resetBtn.textContent = "Reset to Defaults";
  resetBtn.addEventListener("click", () => {
    if (confirm("Reset all tools to defaults? Custom tools will be lost.")) {
      sdk.backend
        .resetToDefaults()
        .then(() => refreshToolList(sdk, listContainer))
        .catch((err: unknown) => sdk.window.showToast(`Reset failed: ${err}`, { variant: "error" }));
    }
  });

  toolbar.appendChild(addBtn);
  toolbar.appendChild(detectBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(importBtn);
  toolbar.appendChild(resetBtn);
  panel.appendChild(toolbar);

  const listContainer = document.createElement("div");
  panel.appendChild(listContainer);

  refreshToolList(sdk, listContainer);

  return panel;
}

function refreshToolList(sdk: CaidoSDK, container: HTMLElement): void {
  container.innerHTML = '<div style="padding:20px;color:var(--c-fg-subtle,#999)">Loading tools...</div>';
  sdk.backend
    .getTools()
    .then((tools) => renderToolList(sdk, container, tools))
    .catch(() => {
      container.innerHTML =
        '<div style="padding:20px;color:#ef4444;">Failed to load tools. Check backend logs.</div>';
    });
}

function renderToolList(
  sdk: CaidoSDK,
  container: HTMLElement,
  tools: ToolConfig[]
): void {
  container.innerHTML = "";

  const groups = groupToolsByCategory(tools);

  for (const [groupName, groupTools] of groups) {
    const header = document.createElement("div");
    header.className = "dispatch-tool-group-header";
    header.textContent = groupName;
    container.appendChild(header);

    for (let i = 0; i < groupTools.length; i++) {
      const tool = groupTools[i]!;
      const row = document.createElement("div");
      row.className = `dispatch-tool-row${tool.enabled ? "" : " dispatch-tool-disabled"}`;

      const installed = isToolInstalled(tool);
      if (installed !== null) {
        const indicator = document.createElement("span");
        indicator.className = `dispatch-tool-status ${installed ? "dispatch-tool-status-ok" : "dispatch-tool-status-missing"}`;
        indicator.textContent = installed ? "\u2713" : "\u2717";
        indicator.title = installed ? "Installed" : "Not found";
        row.appendChild(indicator);
      }

      const name = document.createElement("span");
      name.className = "dispatch-tool-name";
      name.textContent = tool.name;
      row.appendChild(name);

      const command = document.createElement("span");
      command.className = "dispatch-tool-command";
      command.textContent = tool.command;
      command.title = tool.command;
      row.appendChild(command);

      const actions = document.createElement("div");
      actions.className = "dispatch-tool-actions";

      const upBtn = document.createElement("button");
      upBtn.className = "dispatch-btn dispatch-btn-sm";
      upBtn.textContent = "\u25B2";
      upBtn.title = "Move up";
      upBtn.disabled = i === 0;
      if (i === 0) upBtn.style.opacity = "0.3";
      upBtn.addEventListener("click", () => {
        swapAndReorder(sdk, container, tools, tool, -1);
      });

      const downBtn = document.createElement("button");
      downBtn.className = "dispatch-btn dispatch-btn-sm";
      downBtn.textContent = "\u25BC";
      downBtn.title = "Move down";
      downBtn.disabled = i === groupTools.length - 1;
      if (i === groupTools.length - 1) downBtn.style.opacity = "0.3";
      downBtn.addEventListener("click", () => {
        swapAndReorder(sdk, container, tools, tool, 1);
      });

      const editBtn = document.createElement("button");
      editBtn.className = "dispatch-btn dispatch-btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        openToolEditor(sdk, tool, () => refreshToolList(sdk, container));
      });

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "dispatch-btn dispatch-btn-sm";
      toggleBtn.textContent = tool.enabled ? "Disable" : "Enable";
      toggleBtn.addEventListener("click", () => {
        const updated = { ...tool, enabled: !tool.enabled };
        sdk.backend
          .saveTool(updated)
          .then(() => refreshToolList(sdk, container))
          .catch((err: unknown) => sdk.window.showToast(`Failed: ${err}`, { variant: "error" }));
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "dispatch-btn dispatch-btn-sm dispatch-btn-danger";
      deleteBtn.textContent = "Del";
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Delete "${tool.name}"?`)) {
          sdk.backend
            .deleteTool(tool.id)
            .then(() => refreshToolList(sdk, container))
            .catch((err: unknown) => sdk.window.showToast(`Failed: ${err}`, { variant: "error" }));
        }
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(actions);

      container.appendChild(row);
    }
  }
}

function swapAndReorder(
  sdk: CaidoSDK,
  container: HTMLElement,
  allTools: ToolConfig[],
  tool: ToolConfig,
  direction: -1 | 1
): void {
  const idx = allTools.findIndex((t) => t.id === tool.id);
  if (idx < 0) return;

  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= allTools.length) return;

  const target = allTools[targetIdx];
  if (!target || target.group !== tool.group) return;

  allTools[idx] = target;
  allTools[targetIdx] = tool;

  const ids = allTools.map((t) => t.id);
  sdk.backend
    .reorderTools(ids)
    .then(() => refreshToolList(sdk, container))
    .catch((err: unknown) => sdk.window.showToast(`Reorder failed: ${err}`, { variant: "error" }));
}
