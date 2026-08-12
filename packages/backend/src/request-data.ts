import type { SDK } from "caido:plugin";
import type { RequestData } from "./types";

export async function extractRequestData(
  sdk: SDK,
  requestId: string
): Promise<RequestData> {
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

  const rawObj = request.getRaw();
  const rawRequest = rawObj.toText();

  // Binary-safe: preserve exact bytes for file placeholders
  const rawRequestBytes = rawObj.toBytes();
  const bodyBytes = request.getBody()?.toRaw() ?? new Uint8Array(0);

  const headers = extractHeadersFromRaw(rawRequest);

  const cookieValues = request.getHeader("Cookie");
  const cookies = Array.isArray(cookieValues)
    ? cookieValues.join("; ")
    : "";

  const uaValues = request.getHeader("User-Agent");
  const userAgent = Array.isArray(uaValues)
    ? uaValues[0] ?? ""
    : "";

  const rootDomain = extractRootDomain(host);

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
    userAgent,
    rootDomain,
    rawRequest,
    rawRequestBytes,
    bodyBytes,
  };
}

export function extractHeadersFromRaw(raw: string): string {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd < 0) return "";
  const firstLineEnd = raw.indexOf("\r\n");
  if (firstLineEnd < 0 || firstLineEnd >= headerEnd) return "";
  return raw.substring(firstLineEnd + 2, headerEnd + 2);
}

// Known multi-part TLDs where the registrable domain is 3+ labels
const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "com.au", "net.au", "org.au", "edu.au",
  "com.br", "org.br", "net.br",
  "co.in", "net.in", "org.in", "gen.in",
  "co.za", "org.za", "web.za",
  "co.kr", "or.kr", "ne.kr",
  "co.nz", "net.nz", "org.nz",
  "com.mx", "org.mx", "net.mx",
  "com.ar", "org.ar", "net.ar",
  "com.cn", "net.cn", "org.cn",
  "com.tw", "org.tw", "net.tw",
  "com.sg", "org.sg", "net.sg",
  "com.hk", "org.hk", "net.hk",
  "co.il", "org.il", "net.il",
  "com.tr", "org.tr", "net.tr",
  "com.pl", "org.pl", "net.pl",
  "co.id", "or.id", "web.id",
  "com.my", "org.my", "net.my",
  "com.ph", "org.ph", "net.ph",
  "com.vn", "org.vn", "net.vn",
  "co.th", "or.th", "in.th",
  "com.es", "org.es", "nom.es",
  "com.pt", "org.pt",
  "co.ke", "or.ke",
  "com.ng", "org.ng",
  "com.eg", "org.eg",
  "com.pk", "org.pk", "net.pk",
]);

function isIPv4Host(host: string): boolean {
  const octets = host.split(".");
  if (octets.length !== 4) return false;

  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function isIPv6Host(host: string): boolean {
  const normalized = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  return normalized.includes(":");
}

export function extractRootDomain(host: string): string {
  const normalizedHost = host.toLowerCase();

  if (isIPv4Host(normalizedHost) || isIPv6Host(normalizedHost) || normalizedHost === "localhost") {
    return host;
  }

  const parts = normalizedHost.split(".");
  if (parts.length <= 2) return normalizedHost;

  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(lastTwo)) {
    return parts.length >= 3
      ? parts.slice(-3).join(".")
      : normalizedHost;
  }

  return parts.slice(-2).join(".");
}
