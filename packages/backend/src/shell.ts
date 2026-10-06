import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import * as os from "os";
import { platform } from "os";
import { shellEscape } from "./placeholder";

/**
 * Shell selection and environment resolution.
 *
 * Dispatch must run tools the way the user runs them in their terminal. That
 * needs three things, and getting any of them wrong is invisible until a tool
 * exits 127 with "command not found":
 *
 * 1. The user's *actual login shell*, not a hardcoded guess. Hardcoding bash
 *    on Linux broke users whose tooling (aliases, functions, custom builtins)
 *    lives in `~/.zshrc`.
 *
 * 2. The *interactive* PATH. Go's `~/go/bin`, Rust's `~/.cargo/bin`, npm/pnpm
 *    global bins and version managers (nvm, mise, asdf) are added from
 *    `~/.zshrc` / `~/.bashrc`, which login *non-interactive* shells never read.
 *
 * 3. An environment that survives the login rc files. Injecting PATH and
 *    spawning `zsh -lc` is not enough: `/etc/profile` — sourced by zsh's
 *    `/etc/zsh/zprofile` via `emulate sh`, and by bash's login startup —
 *    *hard-resets* PATH (`PATH="/usr/local/bin:/usr/bin:/bin/..."`), silently
 *    discarding everything we injected. The same is true of rc files that
 *    assign PATH from scratch.
 *
 * So instead of injecting PATH and hoping, we ask the user's shell once for
 * its fully initialized interactive environment (PATH plus every variable its
 * rc files export), then run commands *with* that environment and *without*
 * re-sourcing login rc files. Output stays clean — no motd, no prompts — and
 * the environment matches the user's terminal.
 *
 * "With that environment" is more literal than it sounds, because Caido's
 * backend is QuickJS/LLRT, not Node, and its `child_process` differs in two
 * ways that both failed *silently* before we read the actual `llrt/child_process`
 * reference (developer.caido.io):
 *
 *   - `SpawnOptions` has no `env` key (only cwd/gid/uid/shell/stdio/
 *     windowsVerbatimArguments). Passing `env:` made `spawn()` throw
 *     synchronously; the rejection was cached by `resolveInteractiveEnv()`
 *     and swallowed by every caller, so "detect tools" answered all-false in
 *     ~3 ms without ever starting a process. The probed environment is
 *     therefore injected into the `-c` script itself (`export K=V; cmd`),
 *     which works on every runtime, Node included.
 *
 *   - ChildProcess emits only `close`/`error`/`exit` — never Node's `spawn`
 *     event. Waiting on `spawn` alone would hang every run forever, so
 *     readiness settles on `error` → `spawn` → zero-delay timer, whichever
 *     comes first.
 *
 * Sandbox note: the same runtime provides reduced `fs` and `os` modules. A
 * named import of something it lacks (`existsSync`, `userInfo`) fails at
 * *link* time and takes the whole plugin down with "Runtime error", so every
 * optional capability here is reached through a lazy `import()` and a
 * `typeof` check. Nothing in this module may statically import from `fs`.
 *
 * It also has **no `process` global at all**: a bare `process.env.SHELL`
 * throws `ReferenceError: process is not defined` at call time, which is how
 * 0.4.3 answered "0/19 tools installed" with one stack trace per binary —
 * `shellCandidates()` blew up before the probe chain was ever built. Every
 * `process.` reference in this plugin therefore sits behind a
 * `typeof process` guard (enforced by a source-level test in shell.test.ts),
 * and the login shell is rediscovered from a child's inherited environment
 * (`SHELL_DISCOVERY_SCRIPT`), because neither `process.env.SHELL` nor
 * `os.userInfo()` is available here.
 *
 * Stream chunks are decoded with `chunkToString`, never `chunk.toString()`:
 * a plain `Uint8Array.toString()` yields "104,101,…" (comma-joined bytes),
 * not text — the chunk type is a runtime detail this module no longer bets on.
 */

const ENV_SENTINEL = "__DISPATCH_ENV__";
const PATH_SENTINEL_START = "__DISPATCH_PATH__";
const PATH_SENTINEL_END = "__DISPATCH_END__";
const PROBE_TIMEOUT_MS = 2000;
const PROBE_MAX_BUFFER = 256 * 1024;

/**
 * Ask a bare child shell for this account's login shell — the only route left
 * when this realm has neither `process.env.SHELL` nor `os.userInfo()`.
 *
 * The child inherits the *real* OS environment Caido itself was started with,
 * so `$SHELL` is readable from there; when even that is unset, the passwd
 * file names the shell for our `$HOME`. Pure POSIX sh: no rc files, no PATH
 * dependency (verified: both branches return /usr/bin/zsh on this machine).
 */
export const SHELL_DISCOVERY_SCRIPT =
  'if [ -n "${SHELL-}" ]; then printf %s "$SHELL"; ' +
  'else while IFS=: read -r n p u g c h s; do ' +
  '[ "$h" = "${HOME-}" ] && [ -n "$h" ] && { printf %s "$s"; break; }; ' +
  "done < /etc/passwd; fi";

/** Shells we know how to invoke in POSIX mode (`-c`). */
const POSIX_SHELLS = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "busybox", "ash",
]);

let cachedCandidates: string[] | undefined;
let cachedEnvPromise: Promise<Record<string, string> | null> | undefined;
let cachedEnvShell: string | undefined;
let discoveryAttempted = false;
let capsLogged = false;

function shellName(shellPath: string): string {
  const parts = shellPath.split("/");
  return (parts[parts.length - 1] ?? shellPath).toLowerCase();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Diagnostics go to the global console, which the SDK documents as currently
 * identical to `sdk.console` — so they land in Caido's plugin log either way.
 * Never throws: logging must not be able to break shell resolution.
 */
function logShell(message: string): void {
  try {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error(`[Dispatch] shell: ${message}`);
    }
  } catch {
    // ignore
  }
}

function normalizeShell(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * UTF-8 decode without assuming `TextDecoder` exists (it may not in a
 * reduced QuickJS/LLRT realm). Invalid sequences become U+FFFD, matching
 * what TextDecoder does for well-formed input.
 */
export function utf8DecodeFallback(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      continue;
    }
    let need: number;
    let cp: number;
    let min: number;
    if ((b0 & 0xe0) === 0xc0) { need = 1; cp = b0 & 0x1f; min = 0x80; }
    else if ((b0 & 0xf0) === 0xe0) { need = 2; cp = b0 & 0x0f; min = 0x800; }
    else if ((b0 & 0xf8) === 0xf0) { need = 3; cp = b0 & 0x07; min = 0x10000; }
    else { out += "\ufffd"; continue; } // lone continuation or 0xf8+
    let ok = i + need <= bytes.length;
    for (let k = 0; ok && k < need; k++) {
      const bk = bytes[i + k]!;
      if ((bk & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (bk & 0x3f);
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      out += "\ufffd"; // overlong, surrogate, out of range, truncated
      continue;
    }
    i += need;
    out += String.fromCodePoint(cp);
  }
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder().decode(bytes);
    } catch {
      // fall through to the hand-rolled decoder
    }
  }
  return utf8DecodeFallback(bytes);
}

/**
 * Decode a stream chunk to text — the only safe way to consume `data` events.
 *
 * Node hands back Buffers (`toString()` → utf8 text), but the Caido runtime
 * may deliver a plain `Uint8Array`, whose `toString()` is
 * `Array.prototype.toString` and yields "104,101,108,…" — silently corrupting
 * every captured byte. Strings pass through untouched.
 */
export function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return utf8Decode(chunk);
  if (chunk instanceof ArrayBuffer) return utf8Decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return utf8Decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  if (Array.isArray(chunk)) return utf8Decode(Uint8Array.from(chunk));
  return String(chunk);
}

/**
 * Read the login shell from the OS user record, if this runtime exposes it.
 *
 * Best effort only: `$SHELL` is normally set for GUI-launched apps, and the
 * candidate ladder below degrades gracefully when it is not.
 */
function passwdShell(): string | null {
  try {
    // Namespace import: a runtime that lacks this export simply leaves the
    // property undefined, whereas a named import would fail at link time.
    const userInfo = (os as { userInfo?: () => { shell?: string | null } }).userInfo;
    if (typeof userInfo === "function") {
      return normalizeShell(userInfo()?.shell);
    }
  } catch {
    // Runtime without os.userInfo — fall through to the platform default.
  }
  return null;
}

/**
 * Shells to try, best first. The first one that actually spawns wins.
 *
 * Validating by spawning rather than by stat'ing the path keeps this module
 * free of any `fs` dependency, and a missing shell surfaces as a spawn error
 * we can fall through instead of a silent misfire.
 */
export function shellCandidates(): string[] {
  if (cachedCandidates !== undefined) return cachedCandidates;

  const list: string[] = [];
  const push = (candidate: unknown) => {
    const value = normalizeShell(candidate);
    if (value !== null && !list.includes(value)) list.push(value);
  };

  // Caido's realm has no `process` global (module doc); guarded so a bare
  // reference cannot throw and take the whole candidate ladder down.
  push(typeof process !== "undefined" ? process.env.SHELL : undefined);
  push(passwdShell());
  push(platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
  push("/bin/sh");

  cachedCandidates = list;
  return list;
}

/**
 * Resolve the user's login shell: `$SHELL` → passwd record → platform default.
 */
export function resolveUserShell(): string {
  const candidates = shellCandidates();
  // A previously proven shell stays first.
  if (cachedEnvShell !== undefined && candidates.includes(cachedEnvShell)) {
    return cachedEnvShell;
  }
  return candidates[0] ?? "/bin/sh";
}

/** Test seam — clears memoized shell/environment lookups. */
export function resetShellCache(): void {
  cachedCandidates = undefined;
  cachedEnvPromise = undefined;
  cachedEnvShell = undefined;
  discoveryAttempted = false;
}

/**
 * Parse an NUL-separated environment dump that follows our sentinel.
 *
 * Values may contain any byte except NUL, so splitting on `\0` keeps values
 * like `MULTILINE=a\nb` intact. Entries without a `=`, non-identifier keys and
 * the shell's internal `_` entry are dropped.
 */
export function parseProbedEnv(stdout: string): Record<string, string> | null {
  const nulIndex = stdout.indexOf("\0");
  if (nulIndex === -1) return null;
  if (!stdout.slice(0, nulIndex).includes(ENV_SENTINEL)) return null;

  const env: Record<string, string> = {};
  for (const entry of stdout.slice(nulIndex + 1).split("\0")) {
    if (entry.length === 0) continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (key === "_" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = entry.slice(eq + 1);
  }

  return Object.keys(env).length > 0 ? env : null;
}

/**
 * Extract a PATH value from probe output that may contain rc-file noise.
 *
 * Kept as a fallback for shells whose `env` lacks `-0`, where only a PATH
 * probe can be trusted. Anything outside the sentinels is ignored.
 */
export function extractProbedPath(stdout: string): string | null {
  const start = stdout.indexOf(PATH_SENTINEL_START);
  if (start === -1) return null;
  const end = stdout.indexOf(PATH_SENTINEL_END, start);
  if (end === -1) return null;
  const value = stdout.slice(start + PATH_SENTINEL_START.length, end).trim();
  return value.length > 0 ? value : null;
}

function runProbe(shell: string, script: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    // done() closes over both. The sync-throw path below resolves directly
    // and never calls done(), so these stay out of the temporal dead zone.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;

    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      resolve(value);
    };

    // -l (login) and -i (interactive) together are what a real terminal runs,
    // so this is the only invocation that sees the user's PATH additions.
    // No `env` option: Caido's LLRT SpawnOptions has no such key, and passing
    // one throws synchronously (module doc) — which is exactly how detection
    // once answered "not installed" for everything in ~3 ms.
    //
    // `stdio` is cast to a non-tuple array deliberately: the runtime's tuple
    // overload returns ChildProcessByStdio with its own stream type, which is
    // not assignable to ChildProcess (same trick as spawnOnce).
    try {
      const stdio = ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[];
      child = spawn(shell, ["-l", "-i", "-c", script], { stdio });
    } catch {
      resolve(null); // not executable at all — same outcome as ENOENT
      return;
    }

    timer = setTimeout(() => done(output), PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      if (output.length >= PROBE_MAX_BUFFER) {
        done(null);
        return;
      }
      output += chunkToString(chunk);
    });

    child.on("error", () => done(null));
    child.on("close", (code: number | null) => {
      done(code === 0 ? output : null);
    });
  });
}

function probeEnvFor(shell: string): Promise<Record<string, string> | null> {
  // `env -0` is preferred (captures every variable the rc files exported);
  // the PATH-only probe is the fallback for shells without it.
  const script =
    `printf '${ENV_SENTINEL}\\000'; ` +
    `env -0 2>/dev/null || ` +
    `printf '${PATH_SENTINEL_START}%s${PATH_SENTINEL_END}\\n' "$PATH"`;

  return runProbe(shell, script).then((output) => {
    if (output === null) return null;
    const env = parseProbedEnv(output);
    if (env) return env;
    const path = extractProbedPath(output);
    return path ? { PATH: path } : null;
  });
}

/**
 * Run a bare script under `/bin/sh` (no login/interactive flags, no rc
 * files, no env prefix) and capture trimmed-on-demand stdout.
 *
 * Used only for shell *discovery*: it deliberately avoids runInUserShell,
 * which itself waits on resolveInteractiveEnv — calling that from here would
 * deadlock the probe chain.
 */
function probeRaw(script: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    // Same settle pattern as runProbe: done() stays out of the temporal
    // dead zone because the sync-throw path resolves directly.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;

    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try { child.kill(); } catch { /* already exited */ }
      resolve(value);
    };

    try {
      const stdio = ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[];
      child = spawn("/bin/sh", ["-c", script], { stdio });
    } catch {
      resolve(null);
      return;
    }

    timer = setTimeout(() => done(output), 1500);
    child.stdout?.on("data", (chunk) => { output += chunkToString(chunk); });
    child.on("error", () => done(null));
    child.on("close", (code: number | null) => done(code === 0 ? output : null));
  });
}

/** The account's login shell as seen by a child of this process, or null. */
export async function discoverUserShell(): Promise<string | null> {
  return normalizeShell(await probeRaw(SHELL_DISCOVERY_SCRIPT));
}

/**
 * Prepend the account's real login shell when the synchronous ladder could
 * not learn one. Under Node/vitest this is a no-op ($SHELL and os.userInfo
 * both work there); under Caido it is the difference between probing zsh
 * (whose ~/.zshrc adds ~/go/bin) and falling through to bash, whose rc files
 * never see Go tooling at all.
 */
async function ensureUserShellCandidate(): Promise<void> {
  const envShell = typeof process !== "undefined" ? normalizeShell(process.env.SHELL) : null;
  if (envShell !== null) return;
  if (passwdShell() !== null) return;
  if (discoveryAttempted) return;
  discoveryAttempted = true;

  const found = await discoverUserShell();
  const candidates = shellCandidates();
  if (found !== null && !candidates.includes(found)) {
    candidates.unshift(found);
    logShell(`discovered login shell from the child environment: ${found}`);
  } else if (found === null) {
    logShell("no $SHELL or passwd entry found; probing platform defaults");
  }
}

/**
 * The environment a tool should run with, resolved once and cached.
 *
 * Tries each shell candidate in turn and remembers which one worked. Returns
 * null when no shell can be interrogated, which lets callers fall back to
 * legacy login-shell behaviour instead of failing.
 */
export function resolveInteractiveEnv(
  shell?: string
): Promise<Record<string, string> | null> {
  if (cachedEnvPromise !== undefined) return cachedEnvPromise;

  // One async IIFE so discovery, the capability log and the probe ladder all
  // share a single promise that can never reject (the .catch below resolves
  // null): a rejection here once poisoned the cache for the plugin's
  // lifetime and collapsed every later run into an instant 127.
  cachedEnvPromise = (async () => {
    if (shell === undefined) await ensureUserShellCandidate();
    const candidates = shell !== undefined ? [shell] : shellCandidates();

    // One-shot diagnostics: tells the plugin log which runtime capabilities
    // exist (the 0.4.3 root cause was `process` being absent outright) and
    // which shells the probe ladder is about to try.
    if (!capsLogged) {
      capsLogged = true;
      logShell(
        `caps: process=${typeof process !== "undefined"} ` +
        `userInfo=${typeof (os as { userInfo?: unknown }).userInfo === "function"} ` +
        `candidates=${candidates.join(", ")}`
      );
    }

    for (const candidate of candidates) {
      const env = await probeEnvFor(candidate);
      if (env !== null) {
        cachedEnvShell = candidate;
        return env;
      }
    }
    logShell("no shell could be probed; callers fall back to login shells");
    return null;
  })().catch((error) => {
    logShell(`interactive env probe failed: ${describeError(error)}`);
    return null;
  });

  return cachedEnvPromise;
}

/**
 * Build the argv for running `command` through `shell`.
 *
 * `login: false` is the default because the injected environment already
 * reflects a login+interactive startup, and re-sourcing rc files is what
 * destroys PATH in the first place.
 */
export function buildShellArgs(
  shell: string,
  command: string,
  options: { login?: boolean } = {}
): string[] {
  if (platform() === "win32") return ["/c", command];

  const login = options.login ?? false;
  if (!POSIX_SHELLS.has(shellName(shell))) {
    return login ? ["-l", "-c", command] : ["-c", command];
  }
  return login ? ["-l", "-c", command] : ["-c", command];
}

/**
 * Shell prelude that injects the probed environment into a `-c` script.
 *
 * This is how the environment reaches the child: Caido's runtime `spawn()`
 * accepts no `env` option (module doc), and without injection the child
 * would inherit the plugin's own bare environment. Only POSIX-style shells
 * get the prelude — fish sources `config.fish` on every invocation, so its
 * environment is already correct, and an exotic shell gets the command
 * untouched rather than a syntax error.
 */
export function buildEnvPrefix(
  shell: string,
  probed: Record<string, string> | null
): string {
  if (probed === null) return "";
  const name = shellName(shell);
  if (name === "fish" || !POSIX_SHELLS.has(name)) return "";

  const assignments = Object.entries(probed).map(
    ([key, value]) => `export ${key}=${shellEscape(value)}`
  );
  // Resolved shell wins over the probe's recorded SHELL (parity with the old
  // env-object merge, where SHELL was written last).
  assignments.push(`export SHELL=${shellEscape(shell)}`);
  return `${assignments.join("; ")}; `;
}

function spawnOnce(
  shell: string,
  command: string,
  probed: Record<string, string> | null,
  options: { detached?: boolean }
): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    // stdio must be explicit: with `detached: true` the embedded runtime does
    // not otherwise create pipes, and stdout/stderr events never fire.
    const stdio = ["ignore", "pipe", "pipe"] as ("ignore" | "pipe")[];
    // The probed environment rides inside the script (see buildEnvPrefix):
    // this runtime's spawn() has no `env` option and throws if you pass one.
    const script = buildEnvPrefix(shell, probed) + command;
    try {
      child = spawn(shell, buildShellArgs(shell, script, { login: probed === null }), {
        detached: options.detached ?? false,
        stdio,
      });
    } catch (error) {
      reject(error);
      return;
    }

    // Settle readiness once: `error` → `spawn` → zero-delay timer, first one
    // wins. Node reports success via `spawn`; Caido's LLRT ChildProcess only
    // ever emits close/error/exit, so the timer stands in for it — waiting on
    // `spawn` alone would hang every run forever. Any pre-settle error (ENOENT
    // for a missing shell) rejects so spawnInUserShell can try the next
    // candidate. The error listener stays attached after settling, so a late
    // failure reaches the caller's own handler instead of becoming an
    // unhandled 'error' event.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(child);
    }, 0);
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(child);
    });
  });
}

/**
 * Spawn a command in the user's own shell with an environment that matches
 * their interactive session.
 */
export async function spawnInUserShell(
  command: string,
  options: { detached?: boolean } = {}
): Promise<ChildProcess> {
  const probed = await resolveInteractiveEnv();

  // Prefer the shell the probe proved works, then fall back through the rest.
  const all = shellCandidates();
  const ordered = cachedEnvShell !== undefined
    ? [cachedEnvShell, ...all.filter((candidate) => candidate !== cachedEnvShell)]
    : all;

  let lastError: unknown;
  for (const shell of ordered) {
    try {
      return await spawnOnce(shell, command, probed, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("failed to spawn shell");
}

/**
 * Run a short command to completion and capture its output.
 *
 * Used for capability detection (`which foo`), where a missing binary is a
 * normal result rather than an error.
 */
export function runInUserShell(
  command: string,
  options: { timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? 3000;

  return spawnInUserShell(command).then(
    (child) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (code: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        };

        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
          finish(124);
        }, timeoutMs);

        child.stdout?.on("data", (chunk) => { stdout += chunkToString(chunk); });
        child.stderr?.on("data", (chunk) => { stderr += chunkToString(chunk); });
        child.on("error", () => finish(127));
        child.on("close", (code: number | null) => finish(code ?? 127));
      })
  ).catch((error) => ({
    code: 127,
    stdout: "",
    // Detection treats 127 + stderr as worth logging, so the actual reason
    // (rather than a silent empty failure) reaches Caido's plugin log.
    stderr: describeError(error),
  }));
}
