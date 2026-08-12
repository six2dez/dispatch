import { describe, it, expect } from "vitest";
import { extractHeadersFromRaw, extractRootDomain } from "./request-data";

describe("extractRootDomain", () => {
  const cases: [string, string][] = [
    ["api.example.com", "example.com"],
    ["a.b.example.com", "example.com"],
    ["example.com", "example.com"],
    ["www.shop.example.co.uk", "example.co.uk"],
    ["a.co.uk", "a.co.uk"],
    ["co.uk", "co.uk"],
    ["API.Example.COM", "example.com"],
    ["www.example.CO.UK", "example.co.uk"],
    ["localhost", "localhost"],
    ["192.168.1.1", "192.168.1.1"],
    ["[::1]", "[::1]"],
    ["::1", "::1"],
    ["single", "single"],
    ["", ""],
    ["..", "."],
  ];

  for (const [host, expected] of cases) {
    it(`${JSON.stringify(host)} -> ${JSON.stringify(expected)}`, () => {
      expect(extractRootDomain(host)).toBe(expected);
    });
  }

  // --- Pinned behaviour that looks wrong and is not ---
  //
  // Every row below is a measured value, not a desired one. This phase's scope fence
  // permits exactly two export keywords in this file's production module and no
  // behaviour change, no v1 requirement covers a fix, and Phase 12 is the only later
  // phase that reopens request-data.ts. Do not "correct" any of these to make a nicer
  // assertion — the pin is the point, and a later fix should arrive as a red test.

  // extractRootDomain("LOCALHOST") yields "LOCALHOST", uppercase intact:
  // request-data.ts:122 returns host, not normalizedHost, so the IP/localhost branch
  // is the only exit that skips lowercasing. TESTING.md's "uppercase is lowercased"
  // and "localhost passes through" are both true but do not compose.
  it("LOCALHOST -> LOCALHOST, uppercase intact (pinned asymmetry)", () => {
    expect(extractRootDomain("LOCALHOST")).toBe("LOCALHOST");
  });

  // isIPv6Host at request-data.ts:111 is includes(":") after optional bracket
  // stripping, so any host:port is classified IPv6 and returned verbatim. Not
  // reachable through Caido today because getHost() excludes the port.
  it("example.com:8080 -> example.com:8080 (pinned defect)", () => {
    expect(extractRootDomain("example.com:8080")).toBe("example.com:8080");
  });

  // A trailing dot is a valid FQDN form. It adds an empty final label, so slice(-2)
  // at request-data.ts:135 picks up the wrong pair and %D would point a host-scoped
  // tool at the registry suffix.
  it("example.com. -> com. (pinned defect)", () => {
    expect(extractRootDomain("example.com.")).toBe("com.");
  });

  // Same mechanism through a multi-part TLD: the empty final label displaces the
  // MULTI_PART_TLDS lookup at request-data.ts:128 as well.
  it("co.uk. -> uk. (pinned defect)", () => {
    expect(extractRootDomain("co.uk.")).toBe("uk.");
  });

  // 999 exceeds 255, so isIPv4Host rejects it and the host falls through to the
  // label logic, which returns the last two labels of what is really an address.
  it("999.1.1.1 -> 1.1 (pinned fall-through)", () => {
    expect(extractRootDomain("999.1.1.1")).toBe("1.1");
  });

  // Five octets is not IPv4 either, so the same fall-through applies.
  it("1.2.3.4.5 -> 4.5 (pinned fall-through)", () => {
    expect(extractRootDomain("1.2.3.4.5")).toBe("4.5");
  });
});

describe("extractHeadersFromRaw", () => {
  // Named by shape rather than by content: embedding raw CRLF in an it() title makes
  // the reporter output unreadable.
  const cases: [string, string, string][] = [
    [
      "headers and body: returns everything after the request line, final CRLF included",
      "GET / HTTP/1.1\r\nHost: a\r\nX: y\r\n\r\nbody",
      "Host: a\r\nX: y\r\n",
    ],
    [
      "headers only, no body",
      "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
      "Host: a\r\n",
    ],
    [
      "no blank-line separator yields an empty string",
      "GET / HTTP/1.1\r\nHost: a\r\n",
      "",
    ],
    [
      "separator with no request line before it yields an empty string",
      "\r\n\r\nbody",
      "",
    ],
    // D-12. Both indexOf calls (request-data.ts:61,63) are CRLF-only, so an LF-only
    // request never finds the separator and the function returns "" — placeholder.ts:52
    // then writes an empty %E headers file with no error anywhere. This phase pins the
    // behaviour rather than changing it; Caido normalises to CRLF, so the path rarely
    // fires in practice. Phase 12 is the natural home for a fix because it already
    // reopens request-data.ts for the response placeholders.
    [
      "LF-only line endings yield an empty string (D-12 known limitation)",
      "GET / HTTP/1.1\nHost: a\nX: y\n\nbody",
      "",
    ],
  ];

  for (const [name, raw, expected] of cases) {
    it(name, () => {
      expect(extractHeadersFromRaw(raw)).toBe(expected);
    });
  }

  // TESTING.md § 5 asks for a bare CR inside a header value but states no expected
  // result, so this one was derived by executing the function rather than from prose.
  // The bare CR at index 20 is not followed by LF, so indexOf("\r\n\r\n") skips past it
  // to the real separator at 22 and the CR survives inside the returned block.
  it("a bare CR inside a header value is preserved verbatim", () => {
    expect(extractHeadersFromRaw("GET / HTTP/1.1\r\nX: a\rb\r\n\r\n")).toBe("X: a\rb\r\n");
  });
});
