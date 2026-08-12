import type { RequestData } from "./types";

export function makeRequestData(overrides: Partial<RequestData> = {}): RequestData {
  // These defaults are pinned to the RESEARCH probe fixture: every expected command
  // string in placeholder.test.ts and presets.test.ts was measured against them, so
  // changing path or query silently invalidates all of them.
  return {
    host: "example.com",
    port: 443,
    path: "/a",
    query: "",
    method: "GET",
    tls: true,
    headers: "Host: example.com\r\n",
    body: "",
    cookies: "session=abc",
    userAgent: "UA",
    rootDomain: "example.com",
    rawRequest: "GET /a HTTP/1.1\r\nHost: example.com\r\n\r\n",
    rawRequestBytes: new Uint8Array(0),
    bodyBytes: new Uint8Array(0),
    ...overrides,
  };
}
