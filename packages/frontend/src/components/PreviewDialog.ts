import type { CaidoSDK } from "../types";
import type { ToolConfig, PlaceholderPreview } from "dispatch-backend";
import { executeTool } from "./ToolPicker";
import { addModalDismissHandlers } from "../utils";

export function openPreviewDialog(
  sdk: CaidoSDK,
  preview: PlaceholderPreview,
  tool: ToolConfig,
  requestIds: string[]
): void {
  const overlay = document.createElement("div");
  overlay.className = "dispatch-preview-overlay";

  const modal = document.createElement("div");
  modal.className = "dispatch-preview-modal";

  // Title
  const title = document.createElement("div");
  title.className = "dispatch-preview-title";
  title.textContent = `Preview: ${tool.name}`;
  modal.appendChild(title);

  // Multi-request note
  if (requestIds.length > 1) {
    const note = document.createElement("div");
    note.className = "dispatch-preview-multi-note";
    note.textContent = `This command will run for ${requestIds.length} requests. Edits to flags/options will apply to all. Request-specific values (%U, %H, %R, etc.) will be re-resolved per request.`;
    modal.appendChild(note);
  }

  // Editable command
  const textarea = document.createElement("textarea");
  textarea.className = "dispatch-preview-command";

  // Placeholder details (collapsible)
  const usedPlaceholders = preview.placeholders.filter((p) => p.used);
  let placeholderDetails: HTMLDetailsElement | null = null;
  if (usedPlaceholders.length > 0) {
    placeholderDetails = document.createElement("details");
    placeholderDetails.className = "dispatch-preview-placeholders";

    const summary = document.createElement("summary");
    summary.textContent = `Placeholders (${usedPlaceholders.length})`;
    placeholderDetails.appendChild(summary);

    const table = document.createElement("table");
    table.className = "dispatch-preview-placeholder-table";

    for (const ph of usedPlaceholders) {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.textContent = ph.key;
      const tdVal = document.createElement("td");
      tdVal.textContent = ph.value;
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      table.appendChild(tr);
    }

    placeholderDetails.appendChild(table);
  }

  if (requestIds.length > 1) {
    // Multi-request: show template in editable textarea
    textarea.value = preview.template;
    modal.appendChild(textarea);

    // Show resolved example as read-only reference
    const refDiv = document.createElement("div");
    refDiv.style.padding = "8px 14px";
    refDiv.style.fontSize = "11px";
    refDiv.style.color = "var(--c-fg-subtle, #888)";
    refDiv.style.borderTop = "1px solid var(--c-border-default, #333)";
    refDiv.style.fontFamily = "monospace";
    refDiv.style.wordBreak = "break-all";

    const refLabel = document.createElement("div");
    refLabel.style.marginBottom = "4px";
    refLabel.style.fontWeight = "600";
    refLabel.textContent = "Preview (1st request):";
    refDiv.appendChild(refLabel);

    const refCmd = document.createElement("div");
    refCmd.textContent = preview.resolvedCommand;
    refDiv.appendChild(refCmd);

    modal.appendChild(refDiv);

    if (placeholderDetails) {
      modal.appendChild(placeholderDetails);
    }
  } else {
    // Single request: show resolved command in editable textarea
    textarea.value = preview.resolvedCommand;
    modal.appendChild(textarea);

    if (placeholderDetails) {
      modal.appendChild(placeholderDetails);
    }
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "dispatch-preview-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "dispatch-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  const copyBtn = document.createElement("button");
  copyBtn.className = "dispatch-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(textarea.value).catch(() => {});
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1500);
  });

  const runBtn = document.createElement("button");
  runBtn.className = "dispatch-btn dispatch-btn-primary";
  runBtn.textContent = "Run";
  runBtn.addEventListener("click", () => {
    const editedCmd = textarea.value;
    overlay.remove();
    executeTool(sdk, tool, requestIds, editedCmd);
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(runBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Keyboard shortcuts
  overlay.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runBtn.click();
    }
  });

  addModalDismissHandlers(overlay);
}
