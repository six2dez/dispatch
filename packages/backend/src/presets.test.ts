import { readFileSync, rmSync } from "fs";
import { dirname } from "path";
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PRESETS } from "./presets";
import { extractAllBinariesFromCommand } from "./detector";
import { resolvePlaceholders } from "./placeholder";
import { makeRequestData } from "./test-fixtures";
import type { RequestData } from "./types";

// Keyed by id, not by array index: reordering DEFAULT_PRESETS must not silently
// re-map an expectation onto a different preset.
const EXPECTED_BINARIES: Record<string, string[]> = {
  "preset-sqlmap-get": ["sqlmap"],
  "preset-sqlmap-request": ["sqlmap"],
  "preset-dalfox": ["dalfox"],
  "preset-dalfox-rawdata": ["dalfox"],
  "preset-ffuf": ["ffuf"],
  "preset-x8": ["x8"],
  "preset-nuclei": ["nuclei"],
  "preset-nuclei-request": ["nuclei"],
  "preset-katana": ["katana"],
  "preset-gospider": ["gospider"],
  "preset-arjun": ["arjun"],
  "preset-subfinder-httpx": ["subfinder", "httpx"],
  "preset-sslscan": ["sslscan"],
  "preset-testssl": ["testssl.sh"],
  "preset-wpscan": ["wpscan"],
  "preset-droopescan": ["droopescan"],
  "preset-linkfinder": ["linkfinder"],
  "preset-httpx": ["httpx"],
  "preset-curl": ["curl"],
};

// The only four presets that reach the temp-file branch, all through %R.
const FILE_PRESET_IDS = new Set([
  "preset-sqlmap-request",
  "preset-dalfox-rawdata",
  "preset-nuclei-request",
  "preset-arjun",
]);

// A full sweep creates four directories. Registered before any assertion runs, so a
// red run cannot leak a <tmpdir>/dispatch-* directory.
const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DEFAULT_PRESETS sweep", () => {
  // Without this a newly added preset would be swept but never checked against an
  // expectation, which is half of what the sweep is for.
  it("EXPECTED_BINARIES covers the corpus exactly", () => {
    expect(Object.keys(EXPECTED_BINARIES).sort()).toEqual(
      DEFAULT_PRESETS.map((preset) => preset.id).sort()
    );
  });

  for (const preset of DEFAULT_PRESETS) {
    it(preset.id, () => {
      expect(extractAllBinariesFromCommand(preset.command)).toEqual(
        EXPECTED_BINARIES[preset.id]
      );

      const data = makeRequestData();
      const { command, tempFiles } = resolvePlaceholders(preset.command, data);
      for (const tempFile of tempFiles) {
        createdDirs.push(dirname(tempFile));
      }

      // Adding %W or %O to a template without adding it to PLACEHOLDER_RE
      // (placeholder.ts:25) leaves the token in the command handed to the shell.
      // The literal WORDLIST and $WPSCAN_API tokens are unaffected — neither is
      // %-prefixed.
      expect(command).not.toMatch(/%[A-Z]/);
      expect(tempFiles).toHaveLength(FILE_PRESET_IDS.has(preset.id) ? 1 : 0);

      // 01-REVIEW.md WR-01: all four %R presets used to write a 0-byte request.raw,
      // because the fixture's rawRequestBytes was an empty array. A file-count check
      // cannot tell "the raw request reached the file" from "an empty file was
      // created". The non-file presets create nothing and are left alone.
      //
      // Two assertions, because one of them cannot do the whole job — and probe P-F
      // proved that rather than the comment merely claiming it. The byte comparison is
      // self-referential against the fixture: both sides trace back to
      // data.rawRequestBytes, so emptying that field moves both and the row stays
      // green. What it does pin is placeholder.ts's wiring — that request.raw receives
      // THIS field and not data.bodyBytes or data.headers.
      //
      // The decode is what makes the row non-vacuous. It reads the file back as text
      // and compares it to a DIFFERENT fixture field, so a request.raw that is empty
      // while the request text is 75 characters long is a contradiction the row can
      // see. That is the WR-01 regression stated as an assertion instead of a hope.
      if (FILE_PRESET_IDS.has(preset.id)) {
        const written = new Uint8Array(readFileSync(tempFiles[0]!));
        expect(written).toEqual(data.rawRequestBytes);
        expect(new TextDecoder().decode(written)).toBe(data.rawRequest);
      }
    });
  }
});

// A sweep that only iterates survives a total collapse of shellEscape into the
// identity function — measured, not theorised. These three rows are what make the
// sweep sensitive to that collapse.
describe("resolved command is exact", () => {
  const cases: [string, Partial<RequestData>, string][] = [
    ["preset-sslscan", { host: "$(id)" }, "sslscan '$(id)':443"],
    ["preset-testssl", { host: "ev il.com" }, "testssl.sh --color 3 'ev il.com':443"],
    [
      "preset-curl",
      { userAgent: "Mozilla/5.0 (X11)" },
      "curl -v -k -L -A 'Mozilla/5.0 (X11)' https://example.com/a",
    ],
  ];

  for (const [presetId, overrides, expected] of cases) {
    it(presetId, () => {
      // 01-REVIEW.md IN-03. The bare defined-ness assertion this replaces already
      // threw, so the non-null access on the next line never ran and no real message
      // was being buried — the one genuine defect is that the failure never named the
      // id it wanted. A narrowing throw fixes that and removes the non-null assertion.
      // Note this is message quality on top of existing coverage: the corpus test
      // above already goes red if a preset id disappears.
      const preset = DEFAULT_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) throw new Error(`preset ${presetId} not found in DEFAULT_PRESETS`);

      const { command } = resolvePlaceholders(preset.command, makeRequestData(overrides));
      expect(command).toBe(expected);
    });
  }
});
