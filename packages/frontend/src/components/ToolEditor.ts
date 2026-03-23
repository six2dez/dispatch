import type { CaidoSDK } from "../types";
import type { ToolConfig } from "dispatch-backend";
import { addModalDismissHandlers } from "../utils";

export function openToolEditor(
  sdk: CaidoSDK,
  existingTool: ToolConfig | null,
  onSave: () => void
): void {
  const overlay = document.createElement("div");
  overlay.className = "dispatch-editor-overlay";

  const modal = document.createElement("div");
  modal.className = "dispatch-editor-modal";

  const title = document.createElement("div");
  title.className = "dispatch-editor-title";
  title.textContent = existingTool ? "Edit Tool" : "Add Tool";
  modal.appendChild(title);

  const body = document.createElement("div");
  body.className = "dispatch-editor-body";

  // Name field
  const nameField = createField("Name", "text", existingTool?.name ?? "");
  body.appendChild(nameField.container);

  // Command field
  const cmdField = createTextareaField(
    "Command",
    existingTool?.command ?? "",
    "e.g. sqlmap -u %U --batch"
  );
  body.appendChild(cmdField.container);

  // Group field
  const groupField = createField("Group", "text", existingTool?.group ?? "");
  body.appendChild(groupField.container);

  // Show preview toggle
  const previewToggle = createToggle(
    "Show preview before run",
    existingTool?.showPreview ?? true
  );
  body.appendChild(previewToggle.container);

  // Enabled toggle
  const enabledToggle = createToggle(
    "Enabled",
    existingTool?.enabled ?? true
  );
  body.appendChild(enabledToggle.container);

  // Detection binary (optional)
  const detBinaryField = createField(
    "Detection binary (optional)",
    "text",
    existingTool?.detectionBinary ?? ""
  );
  body.appendChild(detBinaryField.container);

  modal.appendChild(body);

  // Actions
  const actions = document.createElement("div");
  actions.className = "dispatch-editor-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "dispatch-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  const saveBtn = document.createElement("button");
  saveBtn.className = "dispatch-btn dispatch-btn-primary";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const name = nameField.input.value.trim();
    const command = cmdField.input.value.trim();

    if (!name || !command) {
      sdk.window.showToast("Name and Command are required", { variant: "warning" });
      return;
    }

    const detBin = detBinaryField.input.value.trim();
    const tool: ToolConfig = {
      id: existingTool?.id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      command,
      group: groupField.input.value.trim(),
      showPreview: previewToggle.checkbox.checked,
      enabled: enabledToggle.checkbox.checked,
      sortOrder: existingTool?.sortOrder ?? 999,
      detectionBinary: detBin.length > 0 ? detBin : undefined,
    };

    saveBtn.textContent = "Saving...";
    saveBtn.setAttribute("disabled", "true");
    sdk.backend.saveTool(tool).then(() => {
      overlay.remove();
      onSave();
    }).catch((err: unknown) => {
      saveBtn.textContent = "Save";
      saveBtn.removeAttribute("disabled");
      sdk.window.showToast(`Failed to save: ${err}`, { variant: "error" });
    });
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  addModalDismissHandlers(overlay);
}

function createField(
  label: string,
  type: string,
  value: string
): { container: HTMLElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "dispatch-editor-field";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  container.appendChild(input);

  return { container, input };
}

function createTextareaField(
  label: string,
  value: string,
  placeholder: string
): { container: HTMLElement; input: HTMLTextAreaElement } {
  const container = document.createElement("div");
  container.className = "dispatch-editor-field";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  container.appendChild(labelEl);

  const input = document.createElement("textarea");
  input.value = value;
  input.placeholder = placeholder;
  container.appendChild(input);

  return { container, input };
}

function createToggle(
  label: string,
  checked: boolean
): { container: HTMLElement; checkbox: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "dispatch-editor-toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  container.appendChild(checkbox);

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  container.appendChild(labelEl);

  return { container, checkbox };
}
