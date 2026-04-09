<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import Button from "primevue/button";
import { useSdk } from "../composables/useSdk";
import type { RunState } from "../types";
import { getErrorMessage } from "../utils/errors";

const props = defineProps<{ run: RunState }>();
const sdk = useSdk();
const outputEl = ref<HTMLDivElement>();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

function killProcess(): void {
  sdk.backend.killProcess(props.run.runId);
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.run.command);
    sdk.window.showToast("Copied to clipboard", { variant: "success", duration: 1500 });
  } catch (err: unknown) {
    sdk.window.showToast(`Copy failed: ${getErrorMessage(err, "Could not copy the command")}`, {
      variant: "error",
      duration: 3000,
    });
  }
}

watch(() => props.run.output, () => {
  nextTick(() => {
    if (outputEl.value) {
      outputEl.value.scrollTop = outputEl.value.scrollHeight;
    }
  });
});
</script>

<template>
  <div class="run-block">
    <div class="run-header">
      <div class="run-info">
        <span class="run-tool-name">{{ run.toolName }}</span>
        <span
          v-if="run.requestId"
          class="run-request-id"
        >#{{ run.requestId }}</span>
        <span
          v-if="!run.finished"
          class="run-status-running"
        >running</span>
      </div>
      <Button
        v-if="!run.finished"
        label="Kill"
        severity="danger"
        size="small"
        text
        @click="killProcess"
      />
    </div>

    <div
      class="run-command"
      :title="run.command"
      @click="copyCommand"
    >
      $ {{ run.command }}
    </div>

    <div
      ref="outputEl"
      class="run-output"
    >
      <pre class="run-output-pre">{{ run.output }}</pre>
    </div>

    <details
      v-if="run.stderr.length > 0"
      class="run-stderr"
    >
      <summary>stderr</summary>
      <pre class="run-stderr-pre">{{ run.stderr }}</pre>
    </details>

    <div class="run-footer">
      <template v-if="run.finished">
        <span :class="run.exitCode === 0 ? 'exit-success' : 'exit-error'">
          Exit: {{ run.exitCode }}
        </span>
        <span v-if="run.duration !== null">{{ formatDuration(run.duration) }}</span>
      </template>
      <template v-else>
        <span class="run-status-running">Running...</span>
        <span>{{ new Date(run.startedAt).toLocaleTimeString() }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.run-block {
  margin-bottom: 12px;
  border: 1px solid var(--c-border-default, #333);
  border-radius: 4px;
  overflow: hidden;
}

.run-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--c-bg-subtle, #252525);
  border-bottom: 1px solid var(--c-border-default, #333);
  font-size: 12px;
}

.run-info { display: flex; align-items: center; gap: 8px; }
.run-tool-name { font-weight: 600; color: var(--c-primary, #6366f1); }
.run-request-id { color: var(--c-fg-subtle, #999); font-size: 11px; }
.run-status-running { color: #f59e0b; font-size: 11px; }

.run-command {
  padding: 6px 10px;
  background: var(--c-bg-emphasis, #0d0d0d);
  border-bottom: 1px solid var(--c-border-default, #333);
  font-family: monospace;
  font-size: 11px;
  color: var(--c-fg-subtle, #aaa);
  word-break: break-all;
  cursor: pointer;
}
.run-command:hover { color: var(--c-fg-default, #e0e0e0); }

.run-output {
  background: var(--c-bg-emphasis, #0d0d0d);
  max-height: 400px;
  overflow-y: auto;
}

.run-output-pre {
  margin: 0;
  padding: 8px 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.run-stderr {
  border-top: 1px solid var(--c-border-default, #333);
  background: rgba(239, 68, 68, 0.08);
}

.run-stderr summary {
  cursor: pointer;
  padding: 6px 10px;
  font-size: 11px;
  color: #fca5a5;
}

.run-stderr-pre {
  margin: 0;
  padding: 0 10px 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: #fca5a5;
}

.run-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--c-bg-subtle, #252525);
  border-top: 1px solid var(--c-border-default, #333);
  font-size: 11px;
  color: var(--c-fg-subtle, #999);
}

.exit-success { color: #22c55e; }
.exit-error { color: #ef4444; }
</style>
