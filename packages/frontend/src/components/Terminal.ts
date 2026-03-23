import type { CaidoSDK, RunState } from "../types";
import { formatDuration } from "../utils";

const runs = new Map<string, RunState>();
let terminalContainer: HTMLElement | null = null;

export function createTerminalPanel(sdk: CaidoSDK): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "dispatch-panel dispatch-terminal";

  terminalContainer = panel;

  const empty = document.createElement("div");
  empty.className = "dispatch-terminal-empty";
  empty.textContent = "No commands running. Right-click a request and select \"Dispatch...\" to start.";
  panel.appendChild(empty);

  return panel;
}

export function addRun(run: {
  runId: string;
  toolName: string;
  resolvedCommand: string;
  requestId: string | null;
  startedAt: string;
}): void {
  const state: RunState = {
    runId: run.runId,
    toolName: run.toolName,
    command: run.resolvedCommand,
    requestId: run.requestId,
    exitCode: null,
    duration: null,
    startedAt: run.startedAt,
  };
  runs.set(run.runId, state);
  renderRunBlock(state);
}

export function appendOutput(
  runId: string,
  data: string,
  stream: "stdout" | "stderr"
): void {
  const state = runs.get(runId);
  if (!state) return;

  const outputEl = document.getElementById(`dispatch-output-${runId}`);
  if (!outputEl) return;

  if (stream === "stderr") {
    const span = document.createElement("span");
    span.className = "stderr";
    span.textContent = data;
    outputEl.appendChild(span);
  } else {
    outputEl.appendChild(document.createTextNode(data));
  }

  // Auto-scroll to bottom
  outputEl.scrollTop = outputEl.scrollHeight;
}

export function finishRun(
  runId: string,
  exitCode: number,
  duration: number
): void {
  const state = runs.get(runId);
  if (state) {
    state.exitCode = exitCode;
    state.duration = duration;
  }

  const footer = document.getElementById(`dispatch-footer-${runId}`);
  if (footer) {
    const exitClass =
      exitCode === 0 ? "dispatch-exit-code-success" : "dispatch-exit-code-error";
    const durationStr = formatDuration(duration);
    footer.innerHTML = "";
    const exitSpan = document.createElement("span");
    exitSpan.className = exitClass;
    exitSpan.textContent = `Exit: ${exitCode}`;
    const durationSpan = document.createElement("span");
    durationSpan.textContent = durationStr;
    footer.appendChild(exitSpan);
    footer.appendChild(durationSpan);
  }

  // Remove kill button
  const killBtn = document.getElementById(`dispatch-kill-${runId}`);
  if (killBtn) killBtn.remove();

  // Update status indicator
  const status = document.getElementById(`dispatch-status-${runId}`);
  if (status) status.remove();
}

export function clearTerminal(): void {
  runs.clear();
  if (terminalContainer) {
    terminalContainer.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "dispatch-terminal-empty";
    empty.textContent = "Terminal cleared.";
    terminalContainer.appendChild(empty);
  }
}

function renderRunBlock(state: RunState): void {
  if (!terminalContainer) return;

  // Remove empty message if present
  const empty = terminalContainer.querySelector(".dispatch-terminal-empty");
  if (empty) empty.remove();

  const block = document.createElement("div");
  block.className = "dispatch-run-block";
  block.id = `dispatch-run-${state.runId}`;

  // Header
  const header = document.createElement("div");
  header.className = "dispatch-run-header";

  const info = document.createElement("div");
  info.className = "dispatch-run-header-info";

  const toolName = document.createElement("span");
  toolName.className = "dispatch-run-tool-name";
  toolName.textContent = state.toolName;
  info.appendChild(toolName);

  if (state.requestId) {
    const reqId = document.createElement("span");
    reqId.className = "dispatch-run-request-id";
    reqId.textContent = `#${state.requestId}`;
    info.appendChild(reqId);
  }

  const statusBadge = document.createElement("span");
  statusBadge.id = `dispatch-status-${state.runId}`;
  statusBadge.className = "dispatch-run-status-running";
  statusBadge.textContent = "running";
  info.appendChild(statusBadge);

  header.appendChild(info);

  // Kill button
  const killBtn = document.createElement("button");
  killBtn.id = `dispatch-kill-${state.runId}`;
  killBtn.className = "dispatch-btn dispatch-btn-danger dispatch-btn-sm";
  killBtn.textContent = "Kill";
  killBtn.addEventListener("click", () => {
    const sdk = (window as any).__dispatchSdk as CaidoSDK | undefined;
    if (sdk) sdk.backend.killProcess(state.runId);
  });
  header.appendChild(killBtn);

  block.appendChild(header);

  // Command line
  const cmdLine = document.createElement("div");
  cmdLine.className = "dispatch-run-command";
  cmdLine.textContent = `$ ${state.command}`;
  cmdLine.title = "Click to copy";
  cmdLine.addEventListener("click", () => {
    navigator.clipboard.writeText(state.command).catch(() => {});
  });
  block.appendChild(cmdLine);

  // Output area
  const output = document.createElement("div");
  output.className = "dispatch-run-output";
  output.id = `dispatch-output-${state.runId}`;
  block.appendChild(output);

  // Footer
  const footer = document.createElement("div");
  footer.className = "dispatch-run-footer";
  footer.id = `dispatch-footer-${state.runId}`;
  footer.innerHTML = "";
  const runningSpan = document.createElement("span");
  runningSpan.className = "dispatch-run-status-running";
  runningSpan.textContent = "Running...";
  const timeSpan = document.createElement("span");
  timeSpan.textContent = new Date(state.startedAt).toLocaleTimeString();
  footer.appendChild(runningSpan);
  footer.appendChild(timeSpan);
  block.appendChild(footer);

  // Insert at top
  terminalContainer.insertBefore(block, terminalContainer.firstChild);
}
