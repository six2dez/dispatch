export interface ToolConfig {
  id: string;
  name: string;
  command: string;
  group: string;
  showPreview: boolean;
  enabled: boolean;
  sortOrder: number;
  detectionBinary?: string;
  /**
   * Hard timeout in milliseconds. If set and > 0 the executor sends SIGTERM
   * (then SIGKILL after a 5 s grace period) to the entire process group when
   * the run exceeds this duration. Undefined or 0 means no timeout, matching
   * pre-0.3 behavior.
   */
  timeoutMs?: number;
}

export interface RunEntry {
  id: string;
  toolId: string;
  toolName: string;
  requestId: string | null;
  batchId: string | null;
  resolvedCommand: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "killed" | "error";
}

export interface TerminalOutputEvent {
  runId: string;
  data: string;
  stream: "stdout" | "stderr";
}

export interface TerminalExitEvent {
  runId: string;
  exitCode: number;
  duration: number;
}

/**
 * One row of the preview dialog's placeholder legend. The two string fields
 * answer two different operator questions and neither may displace the other:
 * `value` is what the request carried, so the operator can recognise the
 * request; `escaped` is what the shell will actually receive. They differ
 * exactly when quoting was applied. A legend that shows only `value` beside a
 * quoted command trains the operator to misread the command they are approving.
 */
export interface PlaceholderInfo {
  key: string;
  value: string;
  escaped: string;
  used: boolean;
}

export interface PlaceholderPreview {
  resolvedCommand: string;
  template: string;
  placeholders: PlaceholderInfo[];
}

export interface ToolDetectionResult {
  binary: string;
  installed: boolean;
  path: string | null;
}

export interface RequestData {
  host: string;
  port: number;
  path: string;
  query: string;
  method: string;
  tls: boolean;
  headers: string;
  body: string;
  cookies: string;
  userAgent: string;
  rootDomain: string;
  rawRequest: string;
  // Binary-safe versions for file placeholders (%R, %B)
  rawRequestBytes: Uint8Array;
  bodyBytes: Uint8Array;
}

export interface ResolvedCommand {
  command: string;
  tempFiles: string[];
}

export interface BatchProgressEvent {
  batchId: string;
  completed: number;
  total: number;
  currentRunId: string;
  currentRequestId: string;
  status: "running" | "completed" | "failed";
}

export interface ToolDetectionEntry {
  toolId: string;
  binary: string;
  installed: boolean;
  path: string | null;
  missingBinaries?: string[];
}
