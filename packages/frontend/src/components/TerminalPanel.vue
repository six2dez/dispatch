<script setup lang="ts">
import Button from "primevue/button";
import RunBlock from "./RunBlock.vue";
import { useTerminal } from "../composables/useTerminal";

const { runList, activeBatches, hasRunningProcesses, clearFinished, clearAll } = useTerminal();

function handleClear(): void {
  if (hasRunningProcesses.value) {
    clearFinished();
  } else {
    clearAll();
  }
}
</script>

<template>
  <div class="terminal-panel">
    <div class="terminal-toolbar">
      <Button
        :label="hasRunningProcesses ? 'Clear Finished' : 'Clear All'"
        size="small"
        severity="secondary"
        text
        @click="handleClear"
      />
    </div>

    <div
      v-if="activeBatches.length > 0"
      class="batch-progress-list"
    >
      <div
        v-for="batch in activeBatches"
        :key="batch.batchId"
        class="batch-progress-item"
      >
        <span class="batch-progress-count">Batch {{ batch.completed + 1 }} / {{ batch.total }}</span>
        <span class="batch-progress-request">Request {{ batch.currentRequestId }}</span>
      </div>
    </div>

    <div class="terminal-content">
      <div
        v-if="runList.length === 0"
        class="terminal-empty"
      >
        No commands running. Right-click a request and select "Dispatch..." to start.
      </div>
      <RunBlock
        v-for="run in runList"
        :key="run.runId"
        :run="run"
      />
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.terminal-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.batch-progress-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.batch-progress-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--c-border-default, #333);
  border-radius: 4px;
  background: var(--c-bg-subtle, #252525);
  font-size: 12px;
}

.batch-progress-count {
  color: var(--c-primary, #818cf8);
  font-weight: 600;
}

.batch-progress-request {
  color: var(--c-fg-subtle, #999);
  word-break: break-all;
}

.terminal-content {
  flex: 1;
  overflow-y: auto;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
}

.terminal-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--c-fg-subtle, #666);
  font-style: italic;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
</style>
