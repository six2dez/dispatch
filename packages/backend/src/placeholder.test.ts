import { readFileSync, rmSync, statSync } from "fs";
import { basename, dirname } from "path";
import { describe, it, expect, afterEach } from "vitest";
import { buildPlaceholderInfo, resolvePlaceholders, shellEscape } from "./placeholder";
import { makeRequestData } from "./test-fixtures";
import type { RequestData } from "./types";

// Directories created by the real filesystem branch below. Registered before any
// assertion runs, so a red run cannot leak a <tmpdir>/dispatch-* directory.
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("shellEscape", () => {
  const cases: [string, string][] = [
    ["", "''"],
    ["a b", "'a b'"],
    ["a;b", "'a;b'"],
    ["a&&b", "'a&&b'"],
    ["a|b", "'a|b'"],
    ["$(id)", "'$(id)'"],
    ["`id`", "'`id`'"],
    ["a\nb", "'a\nb'"],
    ["it's", "'it'\\''s'"],
    ["'", "''\\'''"],
    ["café", "'café'"],
    ["*", "'*'"],
    [" ", "' '"],
    ["%U", "%U"],
    // $ is off the allowlist at placeholder.ts:9, but every other $ case in this file
    // also carries ( and ), which stay off the allowlist and keep the value quoted for
    // the wrong reason — so widening the allowlist by the single character $ passed a
    // full run. $HOME and $IFS are the bare shapes that die with it. SAFE-01 has since
    // removed ~ and = from that regex (D-13), and Phase 7 still owns SAFE-02, so the
    // regex remains a phase-owned edit target and still must not move silently.
    ["$HOME", "'$HOME'"],
    ["${HOME}", "'${HOME}'"],
    ["$IFS", "'$IFS'"],
    // Redirection is shape-changing rather than value-changing: unquoted, the value
    // writes a file instead of being read as an operand.
    [">out", "'>out'"],
    // Bare on purpose, and this is the lesson CR-01 paid for: the ~/x and a=b rows
    // below both carry a / and a b, so a one-character regrowth of the allowlist could
    // in principle leave them quoted for some other reason. A single character cannot
    // be quoted for another reason, so these two are what actually pin the removal.
    ["~", "'~'"],
    ["=", "'='"],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(shellEscape(input)).toBe(expected);
    });
  }

  // --- Allowlist: two gaps still pinned, two closed by SAFE-01 ---

  // The allowlist at placeholder.ts:9 accepts a leading dash, so a request-derived
  // value reaches the tool as a flag rather than as an operand. Argument injection,
  // owned by Phase 7 / SAFE-02. Pinned, not fixed: the removal must land as a red
  // test rather than a silent diff.
  it('"--flag" -> --flag unquoted (SAFE-02 gap, Phase 7)', () => {
    expect(shellEscape("--flag")).toBe("--flag");
  });

  // Same mechanism, and the shape that actually hurts: a value of -rf passed to a
  // tool that takes a path. Phase 7 / SAFE-02 owns the fix.
  it('"-rf" -> -rf unquoted (SAFE-02 gap, Phase 7)', () => {
    expect(shellEscape("-rf")).toBe("-rf");
  });

  // SAFE-01, closed here rather than in Phase 7 (D-13). The quoting is what guarantees
  // the tool receives the literal ~/x the request carried: put ~ back on the allowlist
  // and the value is handed to the login shell bare, which expands it to $HOME first,
  // so the tool reads a local path that was never in the request.
  it('"~/x" -> quoted, so the login shell cannot expand it to $HOME', () => {
    expect(shellEscape("~/x")).toBe("'~/x'");
  });

  // SAFE-01, closed here rather than in Phase 7 (D-13). The quoting is what guarantees
  // a=b arrives as an operand: put = back on the allowlist and an unquoted a=b in
  // leading position is read by the shell as an environment assignment, so the tool is
  // invoked with one argument fewer and with an altered environment.
  it('"a=b" -> quoted, so a leading assignment cannot alter the environment', () => {
    expect(shellEscape("a=b")).toBe("'a=b'");
  });
});

describe("resolvePlaceholders", () => {
  // Invariant: every key in the replacements map (placeholder.ts:66-77) except the two
  // documented exceptions %P and %S must have at least one row below whose value
  // requires quoting. A key reached only through the fixture's allowlist-clean defaults
  // resolves identically escaped or not, so dropping its shellEscape lands green —
  // measured on %A, %C, %D and %M, which each survived a full run before the rows below
  // existed. The one key held outside this table is %G, pinned by the exact preset-curl
  // row at presets.test.ts:90-93.
  //
  // Second invariant, from SAFE-01: each character removed from the allowlist needs both
  // a bare row in the shellEscape table above and a row here that carries it through a
  // request-derived key. The bare row proves the character alone is quoted; this one
  // proves the quoting survives the path a real request actually takes.
  const cases: [string, Partial<RequestData>, string][] = [
    ["t %U", {}, "t https://example.com/a"],
    ["t %U", { tls: false, port: 80 }, "t http://example.com/a"],
    ["t %U", { port: 8443 }, "t https://example.com:8443/a"],
    ["t %U %Q", { query: "a=1&b=2" }, "t 'https://example.com/a?a=1&b=2' 'a=1&b=2'"],
    ["t [%Q]", {}, "t ['']"],
    // %P and %S are the two replacement-map entries not passed through shellEscape
    // (placeholder.ts:69,73) — a deliberate exception, pinned here.
    ["t %P %S", { port: 8080, tls: false }, "t 8080 http"],
    ["t %Z %U", {}, "t %Z https://example.com/a"],
    ["t %u %h", {}, "t %u %h"],
    ["t %%U", {}, "t %https://example.com/a"],
    // The single-pass guard at placeholder.ts:83: a resolved value that itself
    // contains a placeholder token must not be substituted a second time.
    ["t %H", { host: "%U.evil.com" }, "t %U.evil.com"],
    // Request-derived shell metacharacters change the command's values, never its shape.
    ["t %H", { host: "$(id)" }, "t '$(id)'"],
    // The same guarantee for the four request-derived keys the fixture reaches only
    // with benign values: the path, the raw Cookie header, the method and the host-
    // derived root domain are all attacker-influenceable through a proxied request.
    ["t %A", { path: "/a b;id" }, "t '/a b;id'"],
    ["t %C", { cookies: "s=$(id)" }, "t 's=$(id)'"],
    ["t %D", { rootDomain: "a b.com" }, "t 'a b.com'"],
    ["t %M", { method: "GET;id" }, "t 'GET;id'"],
    // The two SAFE-01 characters carried through real request-derived keys. A Cookie
    // header always contains =, which makes %C the shape SAFE-01 actually describes,
    // and a tilde in a URL path is ordinary rather than exotic. Both values are written
    // out here instead of leaning on the fixture defaults, so 01-10's fixture work
    // cannot quietly retire the coverage.
    ["t %C", { cookies: "session=abc" }, "t 'session=abc'"],
    ["t %A", { path: "/~user" }, "t '/~user'"],
  ];

  for (const [template, overrides, expected] of cases) {
    it(`${JSON.stringify(template)} @ ${JSON.stringify(overrides)}`, () => {
      const { command } = resolvePlaceholders(template, makeRequestData(overrides));
      expect(command).toBe(expected);
    });
  }
});

describe("resolvePlaceholders file branch", () => {
  it("%R writes the raw bytes to a 0600 file under a dispatch- directory", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x41]);
    const { command, tempFiles } = resolvePlaceholders(
      "tool -r %R",
      makeRequestData({ rawRequestBytes: bytes })
    );
    for (const tempFile of tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(tempFiles).toHaveLength(1);
    const file = tempFiles[0]!;
    expect(basename(file)).toBe("request.raw");
    expect(basename(dirname(file)).startsWith("dispatch-")).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new Uint8Array(readFileSync(file))).toEqual(bytes);
    // The temp path is generated by mkdtempSync, so the expected command is built
    // from the run's own path — still an exact whole-string match, which also proves
    // nothing else was emitted around the path.
    expect(command).toBe(`tool -r ${shellEscape(file)}`);
  });

  it("%E writes the headers to a 0600 file named headers.txt", () => {
    const data = makeRequestData();
    const { command, tempFiles } = resolvePlaceholders("tool -e %E", data);
    for (const tempFile of tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(tempFiles).toHaveLength(1);
    const file = tempFiles[0]!;
    expect(basename(file)).toBe("headers.txt");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe(data.headers);
    expect(command).toBe(`tool -e ${shellEscape(file)}`);
  });

  it("%R %E %B together create three files in one dispatch- directory", () => {
    const { command, tempFiles } = resolvePlaceholders("tool %R %E %B", makeRequestData());
    for (const tempFile of tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(tempFiles).toHaveLength(3);
    const dirs = tempFiles.map((tempFile) => dirname(tempFile));
    expect(new Set(dirs).size).toBe(1);
    expect(basename(dirs[0]!).startsWith("dispatch-")).toBe(true);
    expect(tempFiles.map((tempFile) => basename(tempFile))).toEqual([
      "request.raw",
      "headers.txt",
      "body.txt",
    ]);
    expect(command).toBe(
      `tool ${shellEscape(tempFiles[0]!)} ${shellEscape(tempFiles[1]!)} ${shellEscape(tempFiles[2]!)}`
    );
  });
});

describe("buildPlaceholderInfo", () => {
  it("returns exactly 13 entries", () => {
    expect(buildPlaceholderInfo("x", makeRequestData())).toHaveLength(13);
  });

  it("keys are in the fixed %U..%B order", () => {
    const info = buildPlaceholderInfo("x", makeRequestData());
    expect(info.map((entry) => entry.key)).toEqual([
      "%U",
      "%H",
      "%P",
      "%A",
      "%Q",
      "%M",
      "%S",
      "%C",
      "%G",
      "%D",
      "%R",
      "%E",
      "%B",
    ]);
  });

  it('marks exactly %U and %P as used for template "x %U %P"', () => {
    const info = buildPlaceholderInfo("x %U %P", makeRequestData());
    const used = info.filter((entry) => entry.used).map((entry) => entry.key);
    expect(used).toEqual(["%U", "%P"]);
  });

  // The preview surface shows what the operator typed, so values here are the
  // unescaped originals — unlike resolvePlaceholders, which escapes the same value.
  it("values are the unescaped originals", () => {
    const info = buildPlaceholderInfo("t %H", makeRequestData({ host: "$(id)" }));
    expect(info.find((entry) => entry.key === "%H")).toEqual({
      key: "%H",
      value: "$(id)",
      used: true,
    });
  });

  it("the three file entries carry their fixed descriptions", () => {
    const info = buildPlaceholderInfo("x", makeRequestData());
    expect(info.slice(-3)).toEqual([
      { key: "%R", value: "<raw request file>", used: false },
      { key: "%E", value: "<headers file>", used: false },
      { key: "%B", value: "<body file>", used: false },
    ]);
  });
});
