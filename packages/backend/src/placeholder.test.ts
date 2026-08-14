import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { describe, it, expect, afterEach } from "vitest";
import { buildPlaceholderInfo, resolvePlaceholders, shellEscape } from "./placeholder";
import { makeRequestData } from "./test-fixtures";
import type { RequestData, ResolvedCommand } from "./types";

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
  // Invariant: every key in the `replacements` map that resolvePlaceholders builds,
  // except the two documented exceptions %P and %S, must have at least one row below
  // whose value requires quoting. A key reached only through the fixture's allowlist-clean
  // defaults resolves identically escaped or not, so dropping its shellEscape lands green —
  // measured on %A, %C, %D and %M, which each survived a full run before the rows below
  // existed. The one key held outside this table is %G, pinned by the preset-curl row in
  // presets.test.ts's "resolved command is exact" block.
  //
  // The preview side carries the same rule against a different constructor, and it is
  // argued once rather than twice: describe("buildPlaceholderInfo") at the foot of this
  // file owns the escaped-key invariant for buildEscapedEntry — which of its keys are held
  // by a literal-expectation row, which ride on the wiring walk's fixture, and why that
  // second half is load-bearing. Read it there. This block's subject is the resolved
  // command only, and restating the legend's invariant here would give it a second place
  // to go stale.
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
    // %P and %S are the two replacement-map entries not passed through shellEscape: the
    // map assigns them String(data.port) and buildFullUrl's scheme bare, where every
    // other entry is wrapped in a shellEscape call. A deliberate exception, pinned here.
    ["t %P %S", { port: 8080, tls: false }, "t 8080 http"],
    ["t %Z %U", {}, "t %Z https://example.com/a"],
    ["t %u %h", {}, "t %u %h"],
    ["t %%U", {}, "t %https://example.com/a"],
    // The single-pass guard — the one template.replace(PLACEHOLDER_RE, …) call in
    // resolvePlaceholders: a resolved value that itself contains a placeholder token must
    // not be substituted a second time. "Multi-pass placeholder replacement" is a named
    // hard anti-pattern in CLAUDE.md, and these next two rows are what keep it out.
    //
    // They are a PAIR. Neither is redundant with the other, because a multi-pass rewrite
    // walks the replacements map key by key and which row it breaks depends entirely on
    // which way it walks:
    //
    //   %U is the FIRST key in that map, so a forward-order walk substitutes %U before it
    //   ever reaches %H. By the time %H puts a literal %U into the command the %U pass is
    //   already behind it, and the token survives by accident rather than by design — so
    //   this row stays green under forward order and dies only under reverse.
    //
    //   %D is the LAST scalar key, the mirror image. A forward-order walk substitutes %H
    //   first and then walks on to %D, expanding the token %H just produced and yielding
    //   "t example.com.evil.com" — request-derived data changing the command beyond its
    //   own value. This row dies under forward order and stays green under reverse.
    //
    // The %U row alone is not coverage: with only it present, a genuine forward-order
    // sequential replacement shipped a fully green run (01-REVIEW.md WR-08). Delete
    // either row and one direction of the anti-pattern silently becomes shippable again.
    ["t %H", { host: "%U.evil.com" }, "t %U.evil.com"],
    ["t %H", { host: "%D.evil.com" }, "t %D.evil.com"],
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

  // The three rows above cannot tell a working shellEscape from a missing one, and
  // neither could any exact assertion against an ordinary temp path. mkdtempSync
  // (placeholder.ts:49) builds its path out of letters, digits, /, ., _ and -, every one
  // of which shellEscape leaves unquoted, so "escaped" and "not escaped at all" produce
  // the same string. The rows above compound that by building their expected command
  // with shellEscape on BOTH sides, so they hold under any mutation of it whatsoever.
  //
  // The three rows below supply the missing distinction. os.tmpdir() reads its POSIX
  // environment override at call time, so pointing it at a directory whose name contains
  // a space forces a temp path that genuinely needs quoting, and the expected string is
  // then built from the raw returned path plus literal single quotes — never from the
  // encoder under test. Drop the shellEscape from any one of placeholder.ts:87-89 and
  // the matching row dies. Follow-up to 01-REVIEW.md WR-01.
  //
  // One row per key rather than one covering all three: %R, %E and %B are escaped by
  // three separate calls, so a mutation of one is invisible to a row covering another.
  //
  // POSIX-only, exactly like the 0o600 assertions above (01-REVIEW.md IN-07) — the
  // override is not read on Windows. These rows inherit that constraint, not widen it.
  //
  // The save/restore sits in a try/finally immediately around the call, and the reason
  // is scope rather than survival: vitest does run afterEach on a throwing test, so an
  // afterEach restore would fire too. What this buys is that nothing else in the test,
  // and nothing any later-added hook does, runs while the process-wide override points
  // somewhere unusual.
  it("%R is quoted when the temp root's name contains a space", () => {
    const spacedRoot = mkdtempSync(join(tmpdir(), "dispatch tmp "));
    createdDirs.push(spacedRoot);

    const savedTmpdir = process.env.TMPDIR;
    let resolved: ResolvedCommand;
    try {
      process.env.TMPDIR = spacedRoot;
      resolved = resolvePlaceholders("tool -r %R", makeRequestData());
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
    }
    for (const tempFile of resolved.tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(resolved.tempFiles).toHaveLength(1);
    const file = resolved.tempFiles[0]!;
    // Without this the row degrades silently into an ordinary clean-path test — which
    // would then pass just as happily with no escaping at all — if the override ever
    // stops being honoured.
    expect(file.includes(" ")).toBe(true);
    expect(resolved.command).toBe(`tool -r '${file}'`);
  });

  it("%E is quoted when the temp root's name contains a space", () => {
    const spacedRoot = mkdtempSync(join(tmpdir(), "dispatch tmp "));
    createdDirs.push(spacedRoot);

    const savedTmpdir = process.env.TMPDIR;
    let resolved: ResolvedCommand;
    try {
      process.env.TMPDIR = spacedRoot;
      resolved = resolvePlaceholders("tool -e %E", makeRequestData());
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
    }
    for (const tempFile of resolved.tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(resolved.tempFiles).toHaveLength(1);
    const file = resolved.tempFiles[0]!;
    expect(file.includes(" ")).toBe(true);
    expect(resolved.command).toBe(`tool -e '${file}'`);
  });

  it("%B is quoted when the temp root's name contains a space", () => {
    const spacedRoot = mkdtempSync(join(tmpdir(), "dispatch tmp "));
    createdDirs.push(spacedRoot);

    const savedTmpdir = process.env.TMPDIR;
    let resolved: ResolvedCommand;
    try {
      process.env.TMPDIR = spacedRoot;
      resolved = resolvePlaceholders("tool -b %B", makeRequestData());
    } finally {
      if (savedTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmpdir;
    }
    for (const tempFile of resolved.tempFiles) {
      createdDirs.push(dirname(tempFile));
    }

    expect(resolved.tempFiles).toHaveLength(1);
    const file = resolved.tempFiles[0]!;
    expect(file.includes(" ")).toBe(true);
    expect(resolved.command).toBe(`tool -b '${file}'`);
  });
});

describe("buildPlaceholderInfo", () => {
  // Invariant for this block: every key built with buildEscapedEntry
  // (placeholder.ts:124-138 — %U, %H, %A, %Q, %M, %C, %G and %D, eight of the
  // thirteen) needs one row whose value requires quoting. A key reached only
  // through allowlist-clean values resolves identically under either
  // constructor, so dropping its escaping lands green — which is how %D, %G and
  // %M each survived a full run before the table below existed (01-REVIEW.md
  // WR-07). Two mechanisms cover the eight, and they are not equally strong:
  //
  //   By a literal-expectation row — %H and %C, plus %D, %G and %M in the table
  //   below. These pin the escaped value against a written-out string, so they
  //   fail under an identity shellEscape and under a swapped constructor alike.
  //
  //   By the wiring walk's fixture alone — %U, %A and %Q, which have no row of
  //   their own. makeRequestData({ host: "$(id)", path: "/a b" }) is the only
  //   thing making their values require quoting: the two overrides carry %U and
  //   %A, while %Q rides on the fixture's empty query, since shellEscape("")
  //   is '' and so differs from its input.
  //
  // That second half is load-bearing, and it is retired by editing a fixture
  // rather than by deleting a test. Soften the walk's overrides — a host with no
  // metacharacter, a path with no space — or give the fixture a non-empty query,
  // and those three keys lose their only coverage while every assertion here
  // still passes. expect(quotedCount).toBe(5) at the end of the walk is the
  // guard that makes such an edit arrive as a red test instead of as silence.
  //
  // The count is folded into this description rather than asserted separately
  // (01-REVIEW.md IN-02): toEqual on the full key array pins length and order at
  // once, so a toHaveLength(13) beside it could never fail and 13 was a bare
  // magic number.
  it("returns exactly 13 keys, in the fixed %U..%B order", () => {
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
  // `escaped` is the other half of that same contract: it is what the shell will
  // actually receive, so the legend can answer both questions without either
  // answer displacing the other. Its expected string below is deliberately a
  // literal. This is one of the five rows that tell a working shellEscape from an
  // identity one, and building the expectation by calling shellEscape would
  // forfeit exactly the guarantee the row exists to give.
  it("values are the unescaped originals and escaped carries the quoting", () => {
    const info = buildPlaceholderInfo("t %H", makeRequestData({ host: "$(id)" }));
    expect(info.find((entry) => entry.key === "%H")).toEqual({
      key: "%H",
      value: "$(id)",
      escaped: "'$(id)'",
      used: true,
    });
  });

  // The second value-level pin, and the reason this legend work exists. SAFE-01
  // took = off the allowlist, so an ordinary Cookie header is now quoted in the
  // resolved command. If the legend kept showing only the raw value, the operator
  // would approve a command containing a string the legend never displayed. Both
  // expected strings are literals, for the same reason as the row above.
  it("surfaces the SAFE-01 quoting of an ordinary Cookie value on %C", () => {
    const info = buildPlaceholderInfo("t %C", makeRequestData());
    const cookieEntry = info.find((entry) => entry.key === "%C");
    if (!cookieEntry) throw new Error("no %C entry in the placeholder legend");
    expect(cookieEntry.value).toBe("session=abc");
    expect(cookieEntry.escaped).toBe("'session=abc'");
  });

  // The remaining three escaped keys, and why they needed their own rows. The
  // wiring walk below reaches %D, %G and %M only through the fixture defaults —
  // example.com, UA and GET — which are all allowlist-clean, so shellEscape(v)
  // returns v and both branches of that walk agree whichever constructor built
  // the entry. Switching any of the three from buildEscapedEntry to
  // buildVerbatimEntry therefore shipped a fully green run, and quotedCount
  // stayed at 5, so the non-vacuity guard did not catch it either
  // (01-REVIEW.md WR-07). %G is the User-Agent and %M is the request method:
  // both are written by whoever sent the request, so on a proxied request they
  // are the two values an attacker picks directly, and a User-Agent as ordinary
  // as Mozilla/5.0 (X11) is quoted in the resolved command today. Each row
  // carries a value that genuinely requires quoting, and asserts value as well
  // as escaped so the raw original cannot drift into the escaped form — the
  // failure probe P-D caught in 01-09. Both expected strings per row are
  // literals, never shellEscape calls, for the same reason as the two rows above.
  const escapedCases: [string, Partial<RequestData>, string, string][] = [
    ["%D", { rootDomain: "a b.com" }, "a b.com", "'a b.com'"],
    ["%G", { userAgent: "Mozilla/5.0 (X11)" }, "Mozilla/5.0 (X11)", "'Mozilla/5.0 (X11)'"],
    ["%M", { method: "GET;id" }, "GET;id", "'GET;id'"],
  ];

  for (const [key, overrides, value, escaped] of escapedCases) {
    it(`${key} carries both the raw value and the quoted form the shell receives`, () => {
      const info = buildPlaceholderInfo(`t ${key}`, makeRequestData(overrides));
      const entry = info.find((candidate) => candidate.key === key);
      if (!entry) throw new Error(`no ${key} entry in the placeholder legend`);
      expect(entry.value).toBe(value);
      expect(entry.escaped).toBe(escaped);
    });
  }

  it("the three file entries carry their fixed descriptions", () => {
    const info = buildPlaceholderInfo("x", makeRequestData());
    expect(info.slice(-3)).toEqual([
      { key: "%R", value: "<raw request file>", escaped: "<raw request file>", used: false },
      { key: "%E", value: "<headers file>", escaped: "<headers file>", used: false },
      { key: "%B", value: "<body file>", escaped: "<body file>", used: false },
    ]);
  });

  // A wiring test, and deliberately nothing more. The comparison below is
  // self-referential: both sides call the same encoder, so it holds under ANY
  // implementation of shellEscape, including the identity function. It cannot
  // tell a working encoder from a collapsed one, and reading it as if it could is
  // the mistake this comment exists to prevent.
  //
  // What it does pin is the builder's wiring — that every scalar key routes
  // through the encoder at all. No literal row would catch a key that was simply
  // never wired, which is why this walk is worth keeping despite what it cannot
  // prove.
  //
  // What it does NOT pin, despite the verbatimKeys list reading as if it did, is
  // that %P and %S are the only scalar keys exempt. That exemption is asserted
  // here but cannot fail: a port and a scheme are always allowlist-clean, so
  // escaped and verbatim produce the same string, and switching either to
  // buildEscapedEntry leaves this walk — and the whole suite — green
  // (01-REVIEW.md IN-10). The list says which entries the branch above expects to
  // match, not that the exemption is the right one.
  //
  // The escaped *values* are pinned by the five rows above, whose expected strings
  // are literals and never call shellEscape: "values are the unescaped originals
  // and escaped carries the quoting" (%H), "surfaces the SAFE-01 quoting of an
  // ordinary Cookie value on %C" (%C), and the %D / %G / %M table. Under an
  // identity shellEscape this walk stays green and those five go red. That is the
  // division of labour.
  it("routes every scalar key through shellEscape except %P and %S", () => {
    // %P and %S are bare in the replacement map; %R/%E/%B are descriptions rather
    // than request values and no command ever carries them.
    const verbatimKeys = ["%P", "%S", "%R", "%E", "%B"];
    const info = buildPlaceholderInfo("x", makeRequestData({ host: "$(id)", path: "/a b" }));

    let quotedCount = 0;
    for (const entry of info) {
      if (verbatimKeys.includes(entry.key)) {
        expect(entry.escaped).toBe(entry.value);
      } else {
        expect(entry.escaped).toBe(shellEscape(entry.value));
      }
      if (entry.escaped !== entry.value) quotedCount += 1;
    }

    // Non-vacuity guard, and the only assertion here that is not self-referential:
    // it fails if the fixture ever stops carrying values that need quoting, which
    // would leave every branch above passing trivially.
    expect(quotedCount).toBe(5);
  });
});
