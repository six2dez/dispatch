import { describe, it, expect } from "vitest";
import { extractRootDomain } from "./request-data";

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
