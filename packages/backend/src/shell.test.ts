import { describe, expect, it, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  SHELL_DISCOVERY_SCRIPT,
  buildEnvPrefix,
  buildShellArgs,
  chunkToString,
  discoverUserShell,
  extractProbedPath,
  parseProbedEnv,
  resetShellCache,
  resolveInteractiveEnv,
  resolveUserShell,
  runInUserShell,
  shellCandidates,
  spawnInUserShell,
  utf8DecodeFallback,
} from "./shell";

const originalShell = process.env.SHELL;
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
  process.env.PATH = originalPath;
  resetShellCache();
});

describe("resolveUserShell", () => {
  it("prefers $SHELL when it points at a usable binary", () => {
    process.env.SHELL = "/bin/zsh";
    resetShellCache();
    expect(resolveUserShell()).toBe("/bin/zsh");
  });

  it("keeps a bogus $SHELL as the first candidate and appends fallbacks", () => {
    // Existence is deliberately not checked with fs.existsSync: Caido's backend
    // runtime has no such export and a named import of it kills the whole
    // plugin at link time. A bad $SHELL is instead rejected by the spawn
    // ENOENT fallback in spawnInUserShell.
    process.env.SHELL = "/nonexistent/shell/binary";
    resetShellCache();
    const candidates = shellCandidates();
    expect(candidates[0]).toBe("/nonexistent/shell/binary");
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.slice(1).every((candidate) => candidate.startsWith("/"))).toBe(true);
  });

  it("ignores an empty $SHELL", () => {
    process.env.SHELL = "   ";
    resetShellCache();
    expect(resolveUserShell()).toMatch(/^\//);
  });

  it("memoizes the resolved shell", () => {
    process.env.SHELL = "/bin/zsh";
    resetShellCache();
    const first = resolveUserShell();
    process.env.SHELL = "/bin/dash";
    expect(resolveUserShell()).toBe(first);
  });
});

describe("parseProbedEnv", () => {
  it("parses the NUL-separated dump after the sentinel", () => {
    const raw = `motd noise\n__DISPATCH_ENV__\0PATH=/usr/bin:/bin\0HOME=/home/aceos\0`;
    expect(parseProbedEnv(raw)).toEqual({ PATH: "/usr/bin:/bin", HOME: "/home/aceos" });
  });

  it("keeps values containing newlines and spaces", () => {
    const raw = `__DISPATCH_ENV__\0MULTILINE=a\nb\0MSG=hello world\0`;
    expect(parseProbedEnv(raw)).toEqual({ MULTILINE: "a\nb", MSG: "hello world" });
  });

  it("keeps values containing '='", () => {
    const raw = `__DISPATCH_ENV__\0OPTS=--flag=a=b\0`;
    expect(parseProbedEnv(raw)).toEqual({ OPTS: "--flag=a=b" });
  });

  it("drops the shell's internal '_' entry and malformed entries", () => {
    const raw = `__DISPATCH_ENV__\0_=/usr/bin/zsh\0noequals\0-1BAD=x\0GOOD=y\0`;
    expect(parseProbedEnv(raw)).toEqual({ GOOD: "y" });
  });

  it("returns null without a NUL or sentinel (env -0 unsupported)", () => {
    expect(parseProbedEnv("__DISPATCH_PATH__/usr/bin__DISPATCH_END__\n")).toBeNull();
    expect(parseProbedEnv("")).toBeNull();
  });

  it("returns null for an empty dump", () => {
    expect(parseProbedEnv(`__DISPATCH_ENV__\0`)).toBeNull();
  });
});

describe("extractProbedPath", () => {
  it("extracts the sentinel value", () => {
    expect(extractProbedPath("__DISPATCH_PATH__/usr/bin:/bin__DISPATCH_END__\n")).toBe(
      "/usr/bin:/bin"
    );
  });

  it("tolerates rc-file noise before and after the sentinel", () => {
    const noisy = [
      "zsh: welcome banner",
      "powerlevel10k instant prompt \u001b[?25l",
      "__DISPATCH_PATH__/home/aceos/go/bin:/usr/bin__DISPATCH_END__",
      "some trailing output",
      "",
    ].join("\n");
    expect(extractProbedPath(noisy)).toBe("/home/aceos/go/bin:/usr/bin");
  });

  it("returns null when the sentinel is missing", () => {
    expect(extractProbedPath("just a motd\n")).toBeNull();
    expect(extractProbedPath("")).toBeNull();
  });

  it("returns null for an empty sentinel value", () => {
    expect(extractProbedPath("__DISPATCH_PATH____DISPATCH_END__")).toBeNull();
  });
});

describe("buildShellArgs", () => {
  it("skips login rc files by default", () => {
    expect(buildShellArgs("/bin/zsh", "echo hi")).toEqual(["-c", "echo hi"]);
    expect(buildShellArgs("/usr/bin/bash", "echo hi")).toEqual(["-c", "echo hi"]);
  });

  it("adds -l only when explicitly requested (probe-failure fallback)", () => {
    expect(buildShellArgs("/bin/zsh", "echo hi", { login: true })).toEqual(["-l", "-c", "echo hi"]);
    expect(buildShellArgs("/opt/weird/osh", "echo hi")).toEqual(["-c", "echo hi"]);
    expect(buildShellArgs("/opt/weird/osh", "echo hi", { login: true })).toEqual(["-l", "-c", "echo hi"]);
  });

  it("passes the command through unmodified", () => {
    const cmd = "nosqli scan -r '/tmp/a b/raw' --dump";
    expect(buildShellArgs("/bin/zsh", cmd)[1]).toBe(cmd);
  });
});

describe("buildEnvPrefix", () => {
  it("exports the probed variables and ends with the resolved shell", () => {
    const prefix = buildEnvPrefix("/bin/zsh", { PATH: "/probed/bin", JAVA_HOME: "/opt/jdk" });
    expect(prefix).toContain("export PATH=/probed/bin");
    expect(prefix).toContain("export JAVA_HOME=/opt/jdk");
    // SHELL is written last so the resolved shell wins over the probe's.
    expect(prefix.endsWith("export SHELL=/bin/zsh; ")).toBe(true);
  });

  it("quotes values the shell would otherwise rewrite", () => {
    const prefix = buildEnvPrefix("/bin/zsh", { MSG: "hello world", MULTI: "a\nb" });
    expect(prefix).toContain("export MSG='hello world'");
    expect(prefix).toContain("export MULTI='a\nb'");
  });

  it("emits nothing when the probe failed, so the login-shell fallback runs clean", () => {
    expect(buildEnvPrefix("/bin/zsh", null)).toBe("");
  });

  it("skips fish, which sources config.fish on every invocation anyway", () => {
    expect(buildEnvPrefix("/usr/bin/fish", { PATH: "/probed/bin" })).toBe("");
  });
});

describe("resolveInteractiveEnv", () => {
  it("captures a usable environment and memoizes the probe", async () => {
    resetShellCache();
    const first = await resolveInteractiveEnv("/bin/sh");
    expect(first?.PATH).toBeTruthy();
    const second = await resolveInteractiveEnv("/bin/sh");
    expect(second).toBe(first);
  });

  it("returns null when the shell cannot be probed", async () => {
    resetShellCache();
    expect(await resolveInteractiveEnv("/nonexistent/shell")).toBeNull();
  });
});

describe("spawnInUserShell", () => {
  function run(
    command: string
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      spawnInUserShell(command)
        .then((child) => {
          child.stdout?.on("data", (d) => { stdout += d.toString(); });
          child.stderr?.on("data", (d) => { stderr += d.toString(); });
          child.on("close", (code) => resolve({ code, stdout, stderr }));
          child.on("error", () => resolve({ code: -1, stdout, stderr }));
        })
        .catch((err: Error) => resolve({ code: -1, stdout, stderr: err.message }));
    });
  }

  it("executes a command through the user's login shell", async () => {
    const result = await run("printf dispatch-shell-ok");
    expect(result.stdout).toContain("dispatch-shell-ok");
    expect(result.code).toBe(0);
  });

  it("runs the command with the user's own $SHELL available to it", async () => {
    process.env.SHELL = "/bin/zsh";
    resetShellCache();
    const result = await run('printf "%s" "${ZSH_VERSION:-no-zsh}"');
    if (resolveUserShell() === "/bin/zsh") {
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stdout).not.toBe("no-zsh");
    }
  });

  it("keeps PATH additions that only exist in an interactive rc file", async () => {
    // The executor must inherit the probed PATH, not the bare process PATH.
    // This is the regression that made `nosqli` (in ~/go/bin, added by
    // .zshrc) fail with exit 127.
    process.env.PATH = "/usr/bin:/bin";
    resetShellCache();
    const result = await run("printf %s \"$PATH\"");
    expect(result.stdout).not.toBe("/usr/bin:/bin");
  });

  it("survives rc files that hard-reset PATH (e.g. /etc/profile)", async () => {
    process.env.PATH = "/usr/bin:/bin";
    resetShellCache();
    const entries = (await run('printf %s "$PATH"')).stdout.split(":");
    // /etc/profile resets PATH to 5 entries; the probed value must still win.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain("/usr/bin");
  });

  it("resolves a real binary from an rc-only PATH directory", async () => {
    resetShellCache();
    const shell = resolveUserShell();
    const probed = await resolveInteractiveEnv(shell);
    if (!probed?.PATH) return;
    // Find any absolute PATH dir the bare process PATH lacks.
    const inherited = new Set((process.env.PATH ?? "").split(":"));
    const extra = probed.PATH.split(":").find((dir) => dir && !inherited.has(dir));
    if (!extra) return;
    // Use the shell itself as the probe target: guaranteed to exist in PATH.
    const result = await run(`command -v ${shellNameOf(shell)}`);
    expect(result.code).toBe(0);
  });

  it("falls back to a working shell when $SHELL does not exist", async () => {
    // This is the behaviour that replaced the fs.existsSync check: a bogus
    // $SHELL must not stop Dispatch from running anything at all.
    process.env.SHELL = "/nonexistent/shell/binary";
    resetShellCache();
    const result = await run("printf dispatch-fallback-ok");
    expect(result.stdout).toContain("dispatch-fallback-ok");
    expect(result.code).toBe(0);
  });
});

describe("runtime compatibility", () => {
  it("never statically imports from fs", () => {
    // Regression guard for the 0.4.1 failure: Caido's backend runtime has no
    // `existsSync` export, and a named import of a missing export fails at link
    // time ("Could not find export 'existsSync' in module 'fs'"), taking down
    // every API route with a runtime error.
    const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/import[^;]*from\s*"fs"/);
  });

  it("never passes an env option to spawn", () => {
    // Regression guard for the 0.4.2 failure: Caido's LLRT SpawnOptions has no
    // `env` key (only cwd/gid/uid/shell/stdio/windowsVerbatimArguments), and
    // passing one makes spawn() throw synchronously — resolveInteractiveEnv
    // cached the rejection and detectTools answered "not installed" for every
    // tool in ~3 ms without starting a single process.
    const source = readFileSync(new URL("./shell.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/env\s*:\s*(process\.env|buildChildEnv)/);
    expect(source).not.toContain("buildChildEnv");
  });

  it("guards every process access in non-test source", () => {
    // Regression guard for the 0.4.3 failure: Caido's backend runtime has no
    // `process` global at all, so shellCandidates() threw "process is not
    // defined" before the probe chain was built and detectTools answered
    // 0/19 in 4 ms with one stack trace per binary. Any `process.` property
    // access must sit within 3 lines of a `typeof process` guard.
    const dir = new URL("./", import.meta.url);
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts")
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const lines = readFileSync(new URL(file, dir), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/\bprocess\.[A-Za-z_$]/.test(line)) return;
        // Comments document the guard but never execute — only code matters.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        if (!window.includes("typeof process")) {
          throw new Error(
            `${file}:${index + 1} reads process without a typeof guard nearby:\n${line}`
          );
        }
      });
    }
  });
});

describe("chunkToString", () => {
  it("passes strings through unchanged", () => {
    expect(chunkToString("hello")).toBe("hello");
  });

  it("decodes UTF-8 byte chunks instead of comma-joining them", () => {
    // A plain Uint8Array.toString() would yield "104,195,169,108,108,111".
    expect(chunkToString(new TextEncoder().encode("héllo"))).toBe("héllo");
  });

  it("decodes Buffers the same way", () => {
    expect(chunkToString(Buffer.from("hello"))).toBe("hello");
  });

  it("decodes ArrayBuffers and plain number arrays", () => {
    expect(chunkToString(new TextEncoder().encode("ok").buffer)).toBe("ok");
    expect(chunkToString([104, 105])).toBe("hi");
  });

  it("stringifies anything else without throwing", () => {
    expect(chunkToString(null)).toBe("null");
  });
});

describe("utf8DecodeFallback", () => {
  it("decodes ASCII and multibyte sequences", () => {
    expect(utf8DecodeFallback(new Uint8Array([0x68, 0xc3, 0xa9]))).toBe("hé");
    expect(utf8DecodeFallback(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))).toBe("😀");
  });

  it("replaces invalid bytes with U+FFFD", () => {
    expect(utf8DecodeFallback(new Uint8Array([0xff, 0x41]))).toBe("\ufffdA");
    expect(utf8DecodeFallback(new Uint8Array([0xc3, 0x41]))).toBe("\ufffdA");
  });
});

describe("shell discovery", () => {
  it("reads $SHELL from the child's inherited environment", async () => {
    const found = await discoverUserShell();
    if (found !== null) expect(found).toMatch(/^\//);
  });

  it("falls back to the passwd entry for $HOME when $SHELL is absent", () => {
    const result = spawnSync("/bin/sh", ["-c", SHELL_DISCOVERY_SCRIPT], {
      env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
    });
    expect(result.stdout.toString()).toMatch(/^\//);
  });
});

describe("runInUserShell", () => {
  it("captures stdout and the exit code", async () => {
    resetShellCache();
    const ok = await runInUserShell("printf hello-from-run");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toBe("hello-from-run");
  });

  it("reports a non-zero exit instead of throwing", async () => {
    resetShellCache();
    const bad = await runInUserShell("exit 3");
    expect(bad.code).toBe(3);
  });
});

function shellNameOf(shellPath: string): string {
  return shellPath.split("/").pop() ?? shellPath;
}
