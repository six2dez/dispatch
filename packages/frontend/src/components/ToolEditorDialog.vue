<script setup lang="ts">
import { ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Checkbox from "primevue/checkbox";
import type { ToolConfig } from "dispatch-backend";
import { useSdk } from "../composables/useSdk";
import { useOverlayHost } from "../composables/useOverlayHost";
import { getErrorMessage } from "../utils/errors";

const sdk = useSdk();
const overlayHost = useOverlayHost();
const emit = defineEmits<{ saved: [] }>();

const visible = ref(false);
const saving = ref(false);
const existingTool = ref<ToolConfig>();
const name = ref("");
const command = ref("");
const group = ref("");
const showPreview = ref(true);
const enabled = ref(true);
const detectionBinary = ref("");

function generateToolId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom-${crypto.randomUUID()}`;
  }

  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function open(tool: ToolConfig | undefined): void {
  existingTool.value = tool;
  name.value = tool?.name ?? "";
  command.value = tool?.command ?? "";
  group.value = tool?.group ?? "";
  showPreview.value = tool?.showPreview ?? true;
  enabled.value = tool?.enabled ?? true;
  detectionBinary.value = tool?.detectionBinary ?? "";
  visible.value = true;
}

async function save(): Promise<void> {
  const n = name.value.trim();
  const c = command.value.trim();
  if (n.length === 0 || c.length === 0) {
    sdk.window.showToast("Name and Command are required", { variant: "warning" });
    return;
  }

  saving.value = true;
  const detBin = detectionBinary.value.trim();
  const tool: ToolConfig = {
    id: existingTool.value?.id ?? generateToolId(),
    name: n,
    command: c,
    group: group.value.trim(),
    showPreview: showPreview.value,
    enabled: enabled.value,
    sortOrder: existingTool.value?.sortOrder ?? 999,
    detectionBinary: detBin.length > 0 ? detBin : undefined,
  };

  try {
    await sdk.backend.saveTool(tool);
    visible.value = false;
    emit("saved");
  } catch (err: unknown) {
    sdk.window.showToast(`Failed to save: ${getErrorMessage(err, "Could not save the tool")}`, {
      variant: "error",
    });
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="existingTool ? 'Edit Tool' : 'Add Tool'"
    :append-to="overlayHost"
    :style="{ width: '500px' }"
  >
    <div class="editor-form">
      <div class="editor-field">
        <label>Name</label>
        <InputText
          v-model="name"
          placeholder="Tool name"
        />
      </div>

      <div class="editor-field">
        <label>Command</label>
        <Textarea
          v-model="command"
          placeholder="e.g. sqlmap -u %U --batch"
          rows="3"
          auto-resize
        />
      </div>

      <div class="editor-field">
        <label>Group</label>
        <InputText
          v-model="group"
          placeholder="Category name"
        />
      </div>

      <div class="editor-field">
        <label>Detection binary (optional)</label>
        <InputText
          v-model="detectionBinary"
          placeholder="Binary name for detection"
        />
      </div>

      <div class="editor-toggle">
        <Checkbox
          v-model="showPreview"
          :binary="true"
          input-id="showPreview"
        />
        <label for="showPreview">Show preview before run</label>
      </div>

      <div class="editor-toggle">
        <Checkbox
          v-model="enabled"
          :binary="true"
          input-id="enabled"
        />
        <label for="enabled">Enabled</label>
      </div>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="visible = false"
      />
      <Button
        label="Save"
        severity="primary"
        :loading="saving"
        @click="save"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.editor-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.editor-field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-fg-subtle, #aaa);
}

.editor-field :deep(input),
.editor-field :deep(textarea) {
  font-family: monospace;
}

.editor-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
</style>
