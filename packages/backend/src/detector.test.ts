import { describe, it, expect } from "vitest";
import { extractAllBinariesFromCommand } from "./detector";

describe("extractAllBinariesFromCommand", () => {
  const cases: [string, string[]][] = [
    ["", []],
    ["   ", []],
    ["sudo nmap -sV %H", ["nmap"]],
    ["HTTP_PROXY=x curl %U", ["curl"]],
    ["%U", []],
    ["nuclei -u %U | nuclei -l x", ["nuclei"]],
    ["subfinder -d %D -silent | httpx -silent", ["subfinder", "httpx"]],
    ["a || b", ["a", "b"]],
    ["cmd1 ; cmd2 && cmd3 | cmd4", ["cmd1", "cmd2", "cmd3", "cmd4"]],
    ["'quoted' -x", ["quoted"]],
    ["sudo sudo env echo", []],
  ];

  for (const [command, expected] of cases) {
    it(`${JSON.stringify(command)} -> ${JSON.stringify(expected)}`, () => {
      expect(extractAllBinariesFromCommand(command)).toEqual(expected);
    });
  }

  // --- Pinned defects ---

  // The while loop at detector.ts:88 strips shell helpers only while they hold the
  // leading position, so it stops at FOO=1; the for loop then skips the assignment
  // and returns nice. Detection therefore probes the wrong binary. TESTING.md's prose
  // claims this yields ffuf — executing the code yields nice, and the measured value
  // is what gets pinned. Phase 6 (DET-01/DET-02) owns the fix.
  it("env FOO=1 nice ffuf -u %U -> [nice] (pinned defect)", () => {
    expect(extractAllBinariesFromCommand("env FOO=1 nice ffuf -u %U")).toEqual(["nice"]);
  });

  // The env reference is skipped as designed, but the loop then returns the *next*
  // token, so detection probes a flag rather than a binary. Phase 6 owns the fix.
  it("$TOOL -u %U -> [-u] (pinned defect)", () => {
    expect(extractAllBinariesFromCommand("$TOOL -u %U")).toEqual(["-u"]);
  });

  // Same mechanism through the braced env-reference form. Phase 6 owns the fix.
  it("${TOOL} -u %U -> [-u] (pinned defect)", () => {
    expect(extractAllBinariesFromCommand("${TOOL} -u %U")).toEqual(["-u"]);
  });
});
