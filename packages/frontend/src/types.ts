import type { Caido } from "@caido/sdk-frontend";
import type { API, Events } from "dispatch-backend";

export type CaidoSDK = Caido<API, Events>;

export interface RunState {
  runId: string;
  toolName: string;
  command: string;
  requestId: string | null;
  exitCode: number | null;
  duration: number | null;
  startedAt: string;
}
