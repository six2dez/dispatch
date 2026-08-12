import { rmSync } from "fs";
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

      const { command, tempFiles } = resolvePlaceholders(preset.command, makeRequestData());
      for (const tempFile of tempFiles) {
        createdDirs.push(dirname(tempFile));
      }

      // Adding %W or %O to a template without adding it to PLACEHOLDER_RE
      // (placeholder.ts:25) leaves the token in the command handed to the shell.
      // The literal WORDLIST and $WPSCAN_API tokens are unaffected — neither is
      // %-prefixed.
      expect(command).not.toMatch(/%[A-Z]/);
      expect(tempFiles).toHaveLength(FILE_PRESET_IDS.has(preset.id) ? 1 : 0);
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
      const preset = DEFAULT_PRESETS.find((entry) => entry.id === presetId);
      expect(preset).toBeDefined();

      const { command } = resolvePlaceholders(preset!.command, makeRequestData(overrides));
      expect(command).toBe(expected);
    });
  }
});
