<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Button from "primevue/button";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import type { RunEntry } from "dispatch-backend";
import { useTerminal } from "../composables/useTerminal";
import { useSdk } from "../composables/useSdk";
import { getErrorMessage } from "../utils/errors";

const sdk = useSdk();
const { completedRunsVersion } = useTerminal();

const rawEntries = ref<RunEntry[]>([]);
const loading = ref(false);
const filterTool = ref("");
const filterStatus = ref("");

// Client-side filtering — no backend re-fetch on filter change
const entries = computed(() => {
  let result = rawEntries.value;
  if (filterTool.value.length > 0) {
    const q = filterTool.value.toLowerCase();
    result = result.filter((e) => e.toolName.toLowerCase().includes(q));
  }
  if (filterStatus.value === "0") {
    result = result.filter((e) => e.exitCode === 0);
  } else if (filterStatus.value === "nonzero") {
    result = result.filter((e) => e.exitCode !== null && e.exitCode !== 0);
  } else if (filterStatus.value === "running") {
    result = result.filter((e) => e.status === "running");
  }
  return result;
});
const outputVisible = ref(false);
const outputTitle = ref("");
const outputStdout = ref("");
const outputStderr = ref("");
const outputRequestId = ref<string | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const statusOptions = [
  { label: "All", value: "" },
  { label: "Exit 0 (success)", value: "0" },
  { label: "Non-zero (error)", value: "nonzero" },
  { label: "Running", value: "running" },
];

function formatDuration(start: string, end: string | null): string {
  if (end === null) return "...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

function exitClass(entry: RunEntry): string {
  if (entry.exitCode === null) {
    return entry.status === "running" ? "status-running" : "";
  }
  return entry.exitCode === 0 ? "exit-success" : "exit-error";
}

function exitDisplay(entry: RunEntry): string {
  if (entry.exitCode !== null) return String(entry.exitCode);
  return entry.status === "running" ? "running" : "-";
}

async function fetchHistory(): Promise<void> {
  loading.value = true;
  try {
    rawEntries.value = await sdk.backend.getHistory(500);
  } catch (err: unknown) {
    sdk.window.showToast(`Failed to load history: ${getErrorMessage(err, "Could not load history")}`, {
      variant: "error",
    });
  } finally {
    loading.value = false;
  }
}

function handleRowClick(event: { data: RunEntry }): void {
  viewOutput(event.data);
}

async function viewOutput(entry: RunEntry): Promise<void> {
  try {
    const output = await sdk.backend.getRunOutput(entry.id);
    outputTitle.value = entry.toolName;
    outputStdout.value = output.stdout;
    outputStderr.value = output.stderr;
    outputRequestId.value = entry.requestId;
    outputVisible.value = true;
  } catch (err: unknown) {
    sdk.window.showToast(`Failed to load output: ${getErrorMessage(err, "Could not load output")}`, {
      variant: "error",
    });
  }
}

async function createFinding(): Promise<void> {
  if (!outputRequestId.value) return;
  try {
    const desc = outputStdout.value
      ? outputStdout.value.slice(0, 2000)
      : outputStderr.value.slice(0, 2000);
    await sdk.backend.createFinding(
      outputRequestId.value,
      `Dispatch: ${outputTitle.value}`,
      desc
    );
    sdk.window.showToast("Finding created", { variant: "success" });
  } catch (err: unknown) {
    sdk.window.showToast(`Failed to create finding: ${getErrorMessage(err, "Could not create the finding")}`, {
      variant: "error",
    });
  }
}

async function clearHistory(): Promise<void> {
  try {
    await sdk.backend.clearHistory();
    await fetchHistory();
  } catch (err: unknown) {
    sdk.window.showToast(`Failed to clear history: ${getErrorMessage(err, "Could not clear the history")}`, {
      variant: "error",
    });
  }
}

function scheduleHistoryRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    void fetchHistory();
  }, 250);
}

watch(completedRunsVersion, () => {
  scheduleHistoryRefresh();
});

onMounted(() => {
  void fetchHistory();
});
onUnmounted(() => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
});
</script>

<template>
  <div class="history-panel">
    <div class="history-toolbar">
      <div class="history-filters">
        <span class="filter-label">Filter:</span>
        <InputText
          v-model="filterTool"
          placeholder="Tool name..."
          size="small"
          class="filter-input"
        />
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          option-label="label"
          option-value="value"
          size="small"
          class="filter-select"
        />
      </div>
      <div class="history-actions">
        <Button
          label="Refresh"
          size="small"
          severity="secondary"
          text
          @click="fetchHistory"
        />
        <Button
          label="Clear History"
          size="small"
          severity="danger"
          text
          @click="clearHistory"
        />
      </div>
    </div>

    <DataTable
      :value="entries"
      :loading="loading"
      striped-rows
      size="small"
      class="history-table"
      @row-click="handleRowClick"
    >
      <Column header="Time">
        <template #body="{ data }">
          {{ new Date((data as RunEntry).startedAt).toLocaleString() }}
        </template>
      </Column>
      <Column
        field="toolName"
        header="Tool"
      />
      <Column header="Command">
        <template #body="{ data }">
          <code
            class="history-command"
            :title="(data as RunEntry).resolvedCommand"
          >
            {{ (data as RunEntry).resolvedCommand }}
          </code>
        </template>
      </Column>
      <Column header="Request">
        <template #body="{ data }">
          {{ (data as RunEntry).requestId ?? "-" }}
        </template>
      </Column>
      <Column header="Exit">
        <template #body="{ data }">
          <span :class="exitClass(data as RunEntry)">{{ exitDisplay(data as RunEntry) }}</span>
        </template>
      </Column>
      <Column header="Duration">
        <template #body="{ data }">
          {{ formatDuration((data as RunEntry).startedAt, (data as RunEntry).finishedAt) }}
        </template>
      </Column>

      <template #empty>
        <div class="history-empty">
          {{ filterTool || filterStatus ? "No matching history entries." : "No history yet." }}
        </div>
      </template>
    </DataTable>

    <!-- Output Dialog -->
    <Dialog
      v-model:visible="outputVisible"
      modal
      :header="`Output: ${outputTitle}`"
      :style="{ width: '700px', maxWidth: '95vw' }"
    >
      <div class="output-content">
        <pre
          v-if="outputStdout"
          class="output-text"
        >{{ outputStdout }}</pre>
        <pre
          v-if="outputStderr"
          class="output-text output-stderr"
        >{{ outputStderr }}</pre>
        <div
          v-if="!outputStdout && !outputStderr"
          class="output-empty"
        >
          (no output)
        </div>
      </div>
      <template #footer>
        <Button
          v-if="outputRequestId"
          label="Create Finding"
          severity="success"
          size="small"
          @click="createFinding"
        />
        <Button
          label="Close"
          severity="secondary"
          text
          @click="outputVisible = false"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.history-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.history-filters {
  display: flex;
  gap: 8px;
  align-items: center;
}

.filter-label {
  font-size: 12px;
  color: var(--c-fg-subtle, #999);
}

.filter-input {
  width: 140px;
}

.filter-select {
  width: 160px;
}

.history-actions {
  display: flex;
  gap: 4px;
}

.history-command {
  font-size: 11px;
  display: block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-empty {
  text-align: center;
  padding: 40px;
  color: var(--c-fg-subtle, #666);
  font-style: italic;
}

:deep(.history-table .p-datatable-row-group-header) {
  display: none;
}

.exit-success { color: #22c55e; }
.exit-error { color: #ef4444; }
.status-running { color: #f59e0b; }

.output-content {
  max-height: 60vh;
  overflow-y: auto;
  background: var(--c-bg-emphasis, #0a0a0a);
  border-radius: 4px;
  padding: 8px;
}

.output-text {
  margin: 0;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.output-stderr {
  color: #ef4444;
}

.output-empty {
  color: var(--c-fg-subtle, #666);
  font-style: italic;
  padding: 20px;
  text-align: center;
}
</style>
