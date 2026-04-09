import { shallowRef, computed, triggerRef, ref } from "vue";
import type { BatchProgressEvent } from "dispatch-backend";
import type { RunState } from "../types";

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB cap to match backend

const runs = shallowRef<Map<string, RunState>>(new Map());
const batches = shallowRef<Map<string, BatchProgressEvent>>(new Map());
const completedRunsVersion = ref(0);

function capOutput(buffer: string): string {
  return buffer.length > MAX_OUTPUT_SIZE
    ? buffer.slice(-MAX_OUTPUT_SIZE)
    : buffer;
}

export function useTerminal() {
  const runList = computed(() => Array.from(runs.value.values()).reverse());
  const activeBatches = computed(() => Array.from(batches.value.values()));

  const hasRunningProcesses = computed(() =>
    Array.from(runs.value.values()).some((r) => !r.finished)
  );

  function addRun(data: {
    runId: string;
    toolName: string;
    resolvedCommand: string;
    requestId: string | null;
    startedAt: string;
  }): void {
    const state: RunState = {
      runId: data.runId,
      toolName: data.toolName,
      command: data.resolvedCommand,
      requestId: data.requestId,
      exitCode: null,
      duration: null,
      startedAt: data.startedAt,
      output: "",
      stderr: "",
      finished: false,
    };
    runs.value.set(data.runId, state);
    triggerRef(runs);
  }

  function appendOutput(runId: string, data: string, stream: "stdout" | "stderr"): void {
    const state = runs.value.get(runId);
    if (!state) return;

    // Mutate in-place — shallowRef won't trigger on deep changes, so we triggerRef manually
    state.output = capOutput(state.output + data);
    if (stream === "stderr") {
      state.stderr = capOutput(state.stderr + data);
    }
    triggerRef(runs);
  }

  function updateBatchProgress(progress: BatchProgressEvent): void {
    if (progress.status === "completed" || progress.completed >= progress.total) {
      batches.value.delete(progress.batchId);
    } else {
      batches.value.set(progress.batchId, progress);
    }
    triggerRef(batches);
  }

  function finishRun(runId: string, exitCode: number, duration: number): void {
    const state = runs.value.get(runId);
    if (!state) return;
    state.exitCode = exitCode;
    state.duration = duration;
    state.finished = true;
    completedRunsVersion.value++;
    triggerRef(runs);
  }

  function clearFinished(): void {
    for (const [id, state] of runs.value) {
      if (state.finished) {
        runs.value.delete(id);
      }
    }
    triggerRef(runs);
  }

  function clearAll(): void {
    runs.value = new Map();
    batches.value = new Map();
    triggerRef(runs);
    triggerRef(batches);
  }

  return {
    runList,
    activeBatches,
    completedRunsVersion,
    hasRunningProcesses,
    addRun,
    appendOutput,
    updateBatchProgress,
    finishRun,
    clearFinished,
    clearAll,
  };
}
