import type { SDK } from "caido:plugin";
import type { RequestData } from "./types";

export async function extractRequestData(
  sdk: SDK,
  requestId: string
): Promise<RequestData> {
  // Use sdk.requests.get(id) — direct lookup by ID
  const item = await sdk.requests.get(requestId);
  if (!item) throw new Error(`Request ${requestId} not found`);

  const request = item.request;

  const host = request.getHost();
  const port = request.getPort();
  const path = request.getPath();
  const query = request.getQuery() ?? "";
  const method = request.getMethod();
  const tls = request.getTls();
  const body = request.getBody()?.toText() ?? "";

  // Get raw request text
  const rawRequest = request.getRaw().toText();

  // Extract headers from raw request
  const headers = extractHeadersFromRaw(rawRequest);

  // Extract Cookie header — getHeader returns Array<string> | undefined
  const cookieValues = request.getHeader("Cookie");
  const cookies = Array.isArray(cookieValues)
    ? cookieValues.join("; ")
    : "";

  return {
    host,
    port,
    path,
    query,
    method,
    tls,
    headers,
    body,
    cookies,
    rawRequest,
  };
}

function extractHeadersFromRaw(raw: string): string {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) return "";
  const firstLineEnd = raw.indexOf("\r\n");
  if (firstLineEnd < 0 || firstLineEnd >= headerEnd) return "";
  return raw.substring(firstLineEnd + 2, headerEnd + 2);
}
