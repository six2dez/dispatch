import { shallowRef, computed, triggerRef } from "vue";
import type { RunState } from "../types";

const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB cap to match backend

const runs = shallowRef<Map<string, RunState>>(new Map());

export function useTerminal() {
  const runList = computed(() => Array.from(runs.value.values()).reverse());

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
    state.output += data;
    if (state.output.length > MAX_OUTPUT_SIZE) {
      state.output = state.output.slice(-MAX_OUTPUT_SIZE);
    }
    if (stream === "stderr") {
      state.stderr += data;
    }
    triggerRef(runs);
  }

  function finishRun(runId: string, exitCode: number, duration: number): void {
    const state = runs.value.get(runId);
    if (!state) return;
    state.exitCode = exitCode;
    state.duration = duration;
    state.finished = true;
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
    triggerRef(runs);
  }

  return { runs, runList, hasRunningProcesses, addRun, appendOutput, finishRun, clearFinished, clearAll };
}
