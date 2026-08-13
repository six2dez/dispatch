import type { RequestData } from "./types";

// One request, not a pile of independently invented fields. In production rawRequest
// and rawRequestBytes are two encodings of a single object (request-data.ts:22,25),
// and cookies / userAgent are read from that same request's headers
// (request-data.ts:30-38) — so a fixture whose Cookie appears nowhere in its raw bytes
// describes a request that could never have been proxied, and a later round-trip
// assertion written against it would be asserting against fiction. 01-REVIEW.md WR-01.
const RAW_REQUEST =
  "GET /a HTTP/1.1\r\nHost: example.com\r\nUser-Agent: UA\r\nCookie: session=abc\r\n\r\n";

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
    // Byte-equal to what request-data.ts's header-block extractor returns for
    // RAW_REQUEST, verified once by executing that function and comparing, then written
    // here as a literal. This file deliberately does not import or name that function:
    // a fixture that calls the function under test cannot be used to test it.
    headers: "Host: example.com\r\nUser-Agent: UA\r\nCookie: session=abc\r\n",
    body: "",
    cookies: "session=abc",
    userAgent: "UA",
    rootDomain: "example.com",
    rawRequest: RAW_REQUEST,
    // Derived, never a literal: production reads these off one object
    // (request-data.ts:22,25 — rawObj.toText() and rawObj.toBytes()), so deriving is
    // what stops the two encodings drifting apart the way they had.
    rawRequestBytes: new TextEncoder().encode(RAW_REQUEST),
    // Deliberately empty and deliberately a literal, unlike the field above: this
    // fixture models the GET on the request line, which has no body. The two byte
    // fields differ in kind on purpose, so neither reads as an oversight.
    bodyBytes: new Uint8Array(0),
    ...overrides,
  };
}
