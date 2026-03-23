import type { CaidoSDK } from "../types";
import type { RunEntry } from "dispatch-backend";
import { formatDuration, addModalDismissHandlers } from "../utils";

export function createHistoryPanel(sdk: CaidoSDK): HTMLElement {
  let filterTool = "";
  let filterExitCode = "";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const panel = document.createElement("div");
  panel.className = "dispatch-panel";

  // Toolbar with filters
  const toolbar = document.createElement("div");
  toolbar.className = "dispatch-history-toolbar";
  toolbar.style.gap = "8px";
  toolbar.style.justifyContent = "space-between";
  toolbar.style.flexWrap = "wrap";

  // Filter controls
  const filters = document.createElement("div");
  filters.style.display = "flex";
  filters.style.gap = "8px";
  filters.style.alignItems = "center";

  const filterLabel = document.createElement("span");
  filterLabel.textContent = "Filter:";
  filterLabel.style.fontSize = "12px";
  filterLabel.style.color = "var(--c-fg-subtle, #999)";
  filters.appendChild(filterLabel);

  const toolInput = document.createElement("input");
  toolInput.type = "text";
  toolInput.placeholder = "Tool name...";
  toolInput.className = "dispatch-history-filter-input";
  toolInput.value = filterTool;
  toolInput.addEventListener("input", () => {
    filterTool = toolInput.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => refreshHistory(sdk, tableBody), 200);
  });
  filters.appendChild(toolInput);

  const exitSelect = document.createElement("select");
  exitSelect.className = "dispatch-history-filter-select";
  const exitOptions: [string, string][] = [
    ["", "Any exit code"],
    ["0", "Exit 0 (success)"],
    ["nonzero", "Non-zero (error)"],
    ["running", "Running"],
  ];
  for (const [value, label] of exitOptions) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === filterExitCode) opt.selected = true;
    exitSelect.appendChild(opt);
  }
  exitSelect.addEventListener("change", () => {
    filterExitCode = exitSelect.value;
    refreshHistory(sdk, tableBody);
  });
  filters.appendChild(exitSelect);

  toolbar.appendChild(filters);

  // Action buttons
  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "dispatch-btn dispatch-btn-sm";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => refreshHistory(sdk, tableBody));

  const clearBtn = document.createElement("button");
  clearBtn.className = "dispatch-btn dispatch-btn-sm dispatch-btn-danger";
  clearBtn.textContent = "Clear History";
  clearBtn.addEventListener("click", () => {
    if (confirm("Clear all history?")) {
      sdk.backend.clearHistory().then(() => {
        refreshHistory(sdk, tableBody);
      }).catch(() => {});
    }
  });

  actions.appendChild(refreshBtn);
  actions.appendChild(clearBtn);
  toolbar.appendChild(actions);
  panel.appendChild(toolbar);

  const table = document.createElement("table");
  table.className = "dispatch-history-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const col of [
    "Time",
    "Tool",
    "Command",
    "Request",
    "Exit",
    "Duration",
  ]) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tableBody = document.createElement("tbody");
  table.appendChild(tableBody);

  panel.appendChild(table);

  function refreshHistory(sdk: CaidoSDK, tbody: HTMLElement): void {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--c-fg-subtle,#999)">Loading...</td></tr>';
    sdk.backend.getHistory(500).then((entries) => {
      const filtered = applyFilters(entries);
      renderHistory(sdk, tbody, filtered);
    }).catch(() => {});
  }

  function applyFilters(entries: RunEntry[]): RunEntry[] {
    let result = entries;

    if (filterTool) {
      const q = filterTool.toLowerCase();
      result = result.filter((e) => e.toolName.toLowerCase().includes(q));
    }

    if (filterExitCode === "0") {
      result = result.filter((e) => e.exitCode === 0);
    } else if (filterExitCode === "nonzero") {
      result = result.filter(
        (e) => e.exitCode !== null && e.exitCode !== 0
      );
    } else if (filterExitCode === "running") {
      result = result.filter((e) => e.status === "running");
    }

    return result;
  }

  function renderHistory(
    sdk: CaidoSDK,
    tbody: HTMLElement,
    entries: RunEntry[]
  ): void {
    tbody.innerHTML = "";

    if (entries.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "dispatch-history-empty";
      td.textContent = filterTool || filterExitCode
        ? "No matching history entries."
        : "No history yet.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const entry of entries) {
      const tr = document.createElement("tr");

      // Time
      const tdTime = document.createElement("td");
      tdTime.textContent = new Date(entry.startedAt).toLocaleString();
      tr.appendChild(tdTime);

      // Tool
      const tdTool = document.createElement("td");
      tdTool.textContent = entry.toolName;
      tr.appendChild(tdTool);

      // Command
      const tdCmd = document.createElement("td");
      tdCmd.className = "dispatch-history-command";
      tdCmd.textContent = entry.resolvedCommand;
      tdCmd.title = entry.resolvedCommand;
      tr.appendChild(tdCmd);

      // Request ID
      const tdReq = document.createElement("td");
      tdReq.textContent = entry.requestId ?? "-";
      tr.appendChild(tdReq);

      // Exit code
      const tdExit = document.createElement("td");
      if (entry.exitCode !== null) {
        tdExit.textContent = String(entry.exitCode);
        tdExit.className =
          entry.exitCode === 0
            ? "dispatch-exit-code-success"
            : "dispatch-exit-code-error";
      } else {
        tdExit.textContent = entry.status === "running" ? "running" : "-";
        if (entry.status === "running") {
          tdExit.className = "dispatch-run-status-running";
        }
      }
      tr.appendChild(tdExit);

      // Duration
      const tdDuration = document.createElement("td");
      if (entry.startedAt && entry.finishedAt) {
        const ms =
          new Date(entry.finishedAt).getTime() -
          new Date(entry.startedAt).getTime();
        tdDuration.textContent = formatDuration(ms);
      } else if (entry.status === "running") {
        tdDuration.textContent = "...";
      } else {
        tdDuration.textContent = "-";
      }
      tr.appendChild(tdDuration);

      // Click to view output
      tr.addEventListener("click", () => {
        sdk.backend.getRunOutput(entry.id).then((output) => {
          showOutputDialog(entry, output);
        }).catch(() => {});
      });

      tbody.appendChild(tr);
    }
  }

  function showOutputDialog(
    entry: RunEntry,
    output: { stdout: string; stderr: string }
  ): void {
    const overlay = document.createElement("div");
    overlay.className = "dispatch-preview-overlay";

    const modal = document.createElement("div");
    modal.className = "dispatch-preview-modal";
    modal.style.maxHeight = "80vh";

    const title = document.createElement("div");
    title.className = "dispatch-preview-title";
    title.textContent = `Output: ${entry.toolName}`;
    modal.appendChild(title);

    const content = document.createElement("div");
    content.className = "dispatch-run-output";
    content.style.maxHeight = "60vh";
    content.style.flex = "1";

    if (output.stdout) {
      content.appendChild(document.createTextNode(output.stdout));
    }
    if (output.stderr) {
      const span = document.createElement("span");
      span.className = "stderr";
      span.textContent = output.stderr;
      content.appendChild(span);
    }
    if (!output.stdout && !output.stderr) {
      content.textContent = "(no output)";
      content.style.color = "var(--c-fg-subtle, #666)";
      content.style.fontStyle = "italic";
    }

    modal.appendChild(content);

    const dlgActions = document.createElement("div");
    dlgActions.className = "dispatch-preview-actions";

    const closeBtn = document.createElement("button");
    closeBtn.className = "dispatch-btn";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => overlay.remove());

    dlgActions.appendChild(closeBtn);
    modal.appendChild(dlgActions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    addModalDismissHandlers(overlay);
  }

  refreshHistory(sdk, tableBody);

  return panel;
}
