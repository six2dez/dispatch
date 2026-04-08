<script setup lang="ts">
import { ref, onMounted } from "vue";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import type { ToolConfig } from "dispatch-backend";
import { useSdk } from "../composables/useSdk";
import { useDetection } from "../composables/useDetection";
import ToolEditorDialog from "./ToolEditorDialog.vue";

const sdk = useSdk();
const { setDetectionResults, isToolInstalled, getMissingBinaries } = useDetection();

const tools = ref<ToolConfig[]>([]);
const loading = ref(false);
const importVisible = ref(false);
const importJson = ref("");
const editorRef = ref<InstanceType<typeof ToolEditorDialog>>();

async function loadTools(): Promise<void> {
  loading.value = true;
  try {
    tools.value = await sdk.backend.getTools();
  } catch {
    sdk.window.showToast("Failed to load tools", { variant: "error" });
  } finally {
    loading.value = false;
  }
}

async function detectTools(): Promise<void> {
  try {
    const detection = await sdk.backend.detectTools();
    setDetectionResults(detection.byToolId);
  } catch (err: unknown) {
    sdk.window.showToast(`Detection failed: ${err}`, { variant: "error" });
  }
}

function addTool(): void {
  editorRef.value?.open(undefined);
}

function editTool(tool: ToolConfig): void {
  editorRef.value?.open(tool);
}

async function toggleTool(tool: ToolConfig): Promise<void> {
  try {
    await sdk.backend.saveTool({ ...tool, enabled: !tool.enabled });
    await loadTools();
  } catch (err: unknown) {
    sdk.window.showToast(`Failed: ${err}`, { variant: "error" });
  }
}

async function deleteTool(tool: ToolConfig): Promise<void> {
  try {
    await sdk.backend.deleteTool(tool.id);
    await loadTools();
  } catch (err: unknown) {
    sdk.window.showToast(`Failed: ${err}`, { variant: "error" });
  }
}

async function exportTools(): Promise<void> {
  try {
    const json = await sdk.backend.exportTools();
    await navigator.clipboard.writeText(json);
    sdk.window.showToast("Exported to clipboard", { variant: "success" });
  } catch (err: unknown) {
    sdk.window.showToast(`Export failed: ${err}`, { variant: "error" });
  }
}

async function importTools(): Promise<void> {
  const json = importJson.value.trim();
  if (json.length === 0) return;
  importVisible.value = false;
  try {
    const result = await sdk.backend.importTools(json);
    sdk.window.showToast(`Imported ${result.imported} tools`, { variant: "success" });
    importJson.value = "";
    await loadTools();
  } catch (err: unknown) {
    sdk.window.showToast(`Import failed: ${err}`, { variant: "error" });
  }
}

async function resetToDefaults(): Promise<void> {
  try {
    await sdk.backend.resetToDefaults();
    await loadTools();
    sdk.window.showToast("Reset to defaults", { variant: "success" });
  } catch (err: unknown) {
    sdk.window.showToast(`Reset failed: ${err}`, { variant: "error" });
  }
}

function getToolStatus(toolId: string): { icon: string; cls: string; tooltip: string } {
  const installed = isToolInstalled(toolId);
  if (installed === true) return { icon: "\u2713", cls: "status-ok", tooltip: "All binaries installed" };
  if (installed === false) {
    const missing = getMissingBinaries(toolId);
    const tip = missing.length > 0 ? `Missing: ${missing.join(", ")}` : "Not found in PATH";
    return { icon: "\u2717", cls: "status-missing", tooltip: tip };
  }
  return { icon: "", cls: "", tooltip: "" };
}

onMounted(loadTools);
</script>

<template>
  <div class="settings-panel">
    <div class="settings-toolbar">
      <Button label="Add Tool" icon="fas fa-plus" severity="primary" size="small" @click="addTool" />
      <Button label="Detect Tools" icon="fas fa-search" severity="secondary" size="small" @click="detectTools" />
      <Button label="Export" icon="fas fa-download" severity="secondary" size="small" @click="exportTools" />
      <Button label="Import" icon="fas fa-upload" severity="secondary" size="small" @click="importVisible = true" />
      <Button label="Reset to Defaults" severity="danger" size="small" text @click="resetToDefaults" />
    </div>

    <DataTable
      :value="tools"
      :loading="loading"
      stripedRows
      size="small"
      rowGroupMode="subheader"
      groupRowsBy="group"
      :rowClass="(data: ToolConfig) => !data.enabled ? 'row-disabled' : ''"
    >
      <Column field="group" header="Group" />
      <template #groupheader="{ data }">
        <span class="group-header">{{ (data as ToolConfig).group || "Other" }}</span>
      </template>

      <Column header="" style="width: 30px">
        <template #body="{ data }">
          <span
            :class="getToolStatus((data as ToolConfig).id).cls"
            class="status-icon"
            :title="getToolStatus((data as ToolConfig).id).tooltip"
          >
            {{ getToolStatus((data as ToolConfig).id).icon }}
          </span>
        </template>
      </Column>

      <Column field="name" header="Name" />
      <Column field="command" header="Command">
        <template #body="{ data }">
          <code class="tool-command" :title="(data as ToolConfig).command">
            {{ (data as ToolConfig).command }}
          </code>
        </template>
      </Column>

      <Column header="Actions" style="width: 220px">
        <template #body="{ data }">
          <div class="tool-actions">
            <Button label="Edit" size="small" severity="secondary" text @click="editTool(data as ToolConfig)" />
            <Button
              :label="(data as ToolConfig).enabled ? 'Disable' : 'Enable'"
              size="small"
              severity="secondary"
              text
              @click="toggleTool(data as ToolConfig)"
            />
            <Button label="Del" size="small" severity="danger" text @click="deleteTool(data as ToolConfig)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Import Dialog -->
    <Dialog v-model:visible="importVisible" modal header="Import Tools" :style="{ width: '500px' }">
      <Textarea v-model="importJson" placeholder="Paste exported JSON here..." rows="8" class="import-textarea" />
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="importVisible = false" />
        <Button label="Import" severity="primary" @click="importTools" />
      </template>
    </Dialog>

    <!-- Tool Editor -->
    <ToolEditorDialog ref="editorRef" @saved="loadTools" />
  </div>
</template>

<style scoped>
.settings-panel {
  max-width: 100%;
}

.settings-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.group-header {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-fg-subtle, #888);
}

.tool-command {
  font-size: 11px;
  color: var(--c-fg-subtle, #888);
  display: block;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-actions {
  display: flex;
  gap: 2px;
}

.status-icon {
  font-size: 13px;
  font-weight: bold;
}

.status-ok { color: #22c55e; }
.status-missing { color: #ef4444; }

:deep(.row-disabled) {
  opacity: 0.5;
}

.import-textarea {
  width: 100%;
  font-family: monospace;
}
</style>
