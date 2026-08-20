# Changelog

## 0.4.0 (2026-08-20)

Test suite, CI gating, and one deliberate change to command escaping. Most
of this entry is internal — Dispatch gains an automated test suite and the
CI that runs it — but the escaping change does alter what a dispatched tool
receives, and it has one user-visible cost. Read the first two Security
bullets before upgrading if any of your tools are configured with a
`~`-relative binary path. Four runtime source files changed — counting
everything under `packages/*/src/` except the co-located `*.test.ts` files
and the `test-fixtures.ts` helper, which are test scaffolding and reach no
build: `placeholder.ts` for the escaping fix and the split that lets the
preview legend show the escaped form, `request-data.ts` for two `export`
keywords added so two existing functions are reachable from a test,
`types.ts` for the `PlaceholderInfo` contract that legend is built on, and
`PreviewDialog.vue` for the legend itself.

### Added

- **Automated test suite.** A vitest 3.2.7 suite covers the pure
  command-resolution logic: `shellEscape`, `resolvePlaceholders` and
  `buildPlaceholderInfo` from the placeholder layer,
  `extractAllBinariesFromCommand` from the binary detector,
  `extractRootDomain` and `extractHeadersFromRaw` from request
  extraction, and `getErrorMessage` from the frontend error helper. A
  regression sweep runs all 19 shipped tool presets through binary
  extraction and placeholder resolution, so a malformed preset fails at
  the moment it is added. `pnpm test` runs the whole suite, and CI runs
  it on every pull request and again on the release path.
- **The preview dialog now shows what the shell will actually receive.**
  Where a request value had to be quoted on its way into the command —
  which the escaping change below makes the normal case for any `Cookie`
  header — the placeholder legend shows the quoted form beneath the raw
  one, so the command in the textarea and the legend beside it can no
  longer disagree. On a multi-request dispatch the textarea holds the
  unresolved template rather than a resolved command, so there the legend
  says `1st request receives` instead of claiming the shell receives that
  exact string: the quoting shown is the first request's, and each of the
  others is resolved separately from the same template.

### Security

- **A request value containing `~` or `=` is no longer rewritten by the
  shell before your tool sees it.** Both characters are now quoted on the
  way into the command, so the value arrives at the tool exactly as it
  appeared in the request, instead of `~/x` being expanded to a path inside
  your home directory and a leading `a=b` being read as an environment
  assignment rather than as an argument.
- **The cost: a tool configured with a `~`-relative binary path now shows
  as not installed.** The binary-detection probe quotes the configured path
  through the same escaping, so a command starting with `~/go/bin/nuclei`
  is no longer expanded by the shell and the tool picker reports it as
  missing — the tool itself still runs correctly, only the badge is wrong.
  Write the path out in full (`/Users/you/go/bin/nuclei`) to get the badge
  back; `$HOME/go/bin/nuclei` will not work, and did not before this change
  either, because `$` has never been on the escaping allowlist.
- **Argument injection remains open.** A request value beginning with `-`
  can still be read by the dispatched tool as a flag rather than as an
  operand, and quoting cannot close it — `'-rf'` is still `-rf` to the
  tool, so the fix is explicit `--` separators in the shipped command
  templates. The repository ships two executable tests that prove the gap
  rather than hiding it; it is tracked as SAFE-02 for the next hardening
  release, and `SECURITY.md` invites reports on exactly this class.
- **Dependency and secret scanning now run in CI.** `trufflehog` fails
  the build when a commit contains a credential — on every pull request,
  on every push to `main`, and again before an immutable signed release is
  produced, because a leaked secret that reaches a published artifact
  cannot be withdrawn. All three invocations keep the `unverified` result
  class (`--results=verified,unverified,unknown`), which is the class a
  self-signed key registered nowhere lands in; a narrower filter scans,
  finds it, and still exits 0. **What the gate does not cover:** it reads
  committed history only, so a secret that is untracked or gitignored — the
  `private.pem` at this repository's root, for one — is never read by it.
  The gate is protection against *committing* a credential, not against
  having one on disk. `osv-scanner` reports known-vulnerable dependencies
  as an advisory annotation rather than a hard failure, so shipping an
  urgent fix is never blocked by a transitive CVE with no available patch;
  its run summary now distinguishes "scanned and found nothing" from
  "reported nothing", so a scanner that dies before writing output no
  longer reads as a clean bill of health.
- **Supported-versions policy corrected.** `SECURITY.md` now states that
  the `0.4.x` line receives security fixes, matching the shipped
  `manifest.json` version, instead of the stale `0.2.x` row that named a
  minor line two releases behind. The row tracks the manifest by rule, not
  by hand: it is asserted equal to
  `jq -r .version manifest.json | cut -d. -f1,2`, so a release that bumps
  the minor line and forgets this file fails its own check.

## 0.3.1 (2026-08-12)

Style isolation release. Installing Dispatch no longer alters Caido's own
theme — the plugin now follows the styling pattern of the official
`caido-community/create-plugin` template. No user-facing workflow changes.

### Fixed

- **Plugin styles no longer leak into Caido.** PrimeVue now runs unstyled with
  `@caido/primevue`'s `Classic` passthrough preset instead of the styled
  `@primevue/themes` Aura theme, which injected a global theme at runtime and
  overrode Caido's own PrimeVue components. Every rule the plugin authors is
  wrapped under a `.plugin--dispatch` scope at build time by
  `postcss-prefixwrap`, and the app root no longer adds `.p-dark` to
  `<html>` — dark mode now follows Caido's `[data-mode="dark"]` attribute, so
  the plugin adapts to the active Caido theme instead of imposing one.
- **Dialogs are scoped without losing their styles.** PrimeVue overlays
  teleport out of the component tree, and the tool picker is opened from the
  request context menu while Caido is showing another page, so they cannot
  render inside the plugin's page body. They are now teleported into a
  dedicated `<body>`-level host that carries the plugin scope, keeping the
  plugin's CSS applied to them and contained at the same time.
- **Tool picker sizing.** The picker dialog is 440px wide again and its content
  padding is reset. Both were set from scoped CSS on the Dialog's own root,
  which Vue never matched because a teleported component root does not inherit
  the parent's scope attribute; they are now passed as props.

## 0.3.0 (2026-04-20)

Release-readiness pass: the plugin now ships with a full CI pipeline, a
signed-release flow triggered from git tags, a formal security policy, a race-
free concurrency limiter, per-tool execution timeouts, and hardened temp-file
permissions. No user-facing workflow changes — everything on top of 0.2.0 is
backward compatible.

### Added

- **Per-tool execution timeout.** New `timeoutMs` field on `ToolConfig` (and the
  `tools.timeout_ms` SQLite column) limits how long a run may execute before
  Dispatch sends SIGTERM to the process group and escalates to SIGKILL after a
  5 s grace period. Absent/0 means no timeout, preserving pre-0.3 behavior.
- **Plugin icon.** `manifest.json` now declares `icon.svg`, bundled into the
  release zip by `scripts/pack.js`.
- **Release signature artifacts.** Release workflow publishes `public.pem`
  alongside `plugin_package.zip` and `plugin_package.zip.sig` so downloaders can verify
  without cloning the repo.
- **CI pipeline.** `.github/workflows/ci.yml` runs lint, typecheck, and build
  on every pull request and push to `main`; PR builds upload the zip as an
  artifact.
- **Dependabot.** Weekly bumps for npm (grouped by eslint / vue / caido) and
  GitHub Actions.
- **Security policy.** `SECURITY.md` documents the reporting process, response
  expectations, threat model, and signature-verification procedure.
- **Packaging metadata.** `package.json` gained `repository`, `homepage`,
  `bugs`, `keywords`, and `engines` fields. Added `.nvmrc` pinning Node 20.17.0.
- **README polish.** Version / CI / license / downloads / last-commit badges,
  embedded screenshots (picker, preview, settings, history), platform-support
  note, troubleshooting section, and release-verification instructions.

### Changed

- **Release workflow.** Now triggers on `v*.*.*` tag pushes in addition to
  manual `workflow_dispatch`, validates that the tag matches `manifest.json`,
  extracts release notes from the matching `CHANGELOG.md` section, and runs
  `pnpm install --frozen-lockfile` before lint → typecheck → build → sign.
- **Concurrency limit is now race-free.** Introduced synchronous `reserveSlot`
  / `releaseSlot` APIs in the executor so `MAX_CONCURRENT = 10` is respected
  even when many concurrent `executeCommand` / `executeBatch` / `executeCustom`
  calls race between the capacity check and the spawn.

### Fixed

- **Race condition in `isAtCapacity()`.** Previously the check and the
  `activeProcesses.set()` were separated by `await` calls, allowing multiple
  concurrent runs to slip past the limit. Slot reservation is now atomic.
- **Stdio capture under detached shells.** `spawnWithLoginShell` now forces
  `stdio: ["ignore", "pipe", "pipe"]` explicitly, so the Node runtime
  embedded in Caido reliably creates stdout/stderr pipes even with
  `detached: true`. Runs that previously looked frozen at "Running…" with
  empty output — despite exiting cleanly in the backend — now stream output
  to the Terminal tab and store it in History.
- **Stranded runs on event drop.** `sdk.api.send` calls for
  `terminal:start` / `terminal:output` / `terminal:exit` are wrapped in
  try/catch with error logging so a transient event-bus failure no longer
  kills the stream handler silently. Frontend `finishRun` additionally
  surfaces a finished run even when `terminal:start` was dropped, instead of
  discarding the completion event.
- **Terminal tab stuck on "Running…" despite completed run.** The shallow
  `RunState` object was mutated in-place, so `v-for :key="runId"` re-used
  the `RunBlock` vnode without re-rendering when `output`, `stderr`, or
  `finished` changed. Both `appendOutput` and `finishRun` now replace the
  Map entry with a fresh object reference, which Vue picks up as a real
  prop change. Output now streams live in the Terminal tab and the run
  transitions to its final `Exit: …` footer as soon as the process closes.

### Security

- **Tightened temp file permissions.** Placeholder files written for `%R`,
  `%E`, and `%B` now use `mode: 0o600` explicitly so other local users cannot
  read raw request bodies, cookies, or bearer tokens from `/tmp`.

## 0.2.0 (2026-04-08)

### Breaking Changes

- **Frontend rewritten to Vue 3 + PrimeVue 4.** All raw DOM manipulation replaced with reactive Vue SFC components.
- **Import generates new IDs.** Imported tools no longer overwrite existing tools with the same ID. Each import creates fresh IDs.
- **`%A` placeholder preserves trailing slash.** Previously `/api/` was stripped to `/api`. Now the path is kept exactly as received from Caido.
- **`detectTools` return type changed.** Now returns `{ results, byToolId }` instead of a flat array.

### Added

- **Caido native CSS variables.** UI uses `--c-bg-default`, `--c-fg-default`, `--c-border-default`, `--c-primary` etc. for automatic theme adaptation.
- **Process group killing.** Kill button terminates the entire process tree (pipes, subprocesses), not just the parent shell. Uses detached login shells plus negative-PID signaling where supported, with direct child termination fallback.
- **Binary-safe file placeholders.** `%R` uses `toBytes()` and `%B` uses `toRaw()` to preserve exact bytes. Non-UTF-8 and binary request bodies are no longer corrupted.
- **Batch progress events.** Backend emits `batch:progress` events with `{ batchId, completed, total, currentRunId, status }`.
- **Batch resilience.** Batch execution continues on individual request failure instead of breaking the chain.
- **Concurrent execution limit.** Max 10 simultaneous processes. Excess requests are rejected with a clear error.
- **Clear terminal preserves running processes.** "Clear Finished" only removes completed runs. Running processes keep their output and kill button.
- **New presets:** x8 (param discovery), gospider (crawling), nuclei request file mode, LinkFinder (JS analysis).
- **Caido Findings integration.** Create a Caido Finding from any completed run, linking the original request and output.
- **Shell environment variables.** Command templates support `$VAR` and `${VAR}` syntax natively since commands run in a login shell.
- **UI state persistence.** Active tab is saved via `sdk.storage`, surviving page navigation.
- **Richer tool detection.** Tools with pipelines detect all required binaries. Missing binary name shown in tooltip.
- **ESLint workflow.** `pnpm run lint` is available, the lint baseline is clean, and release CI runs typecheck before build.
- **Per-tool context menu entries.** Each enabled tool gets its own "Dispatch: toolname" entry in the right-click menu and command palette for one-click dispatch without the picker.

### Changed

- **Frontend architecture.** Vue 3 SFC components with PrimeVue (DataTable, Dialog, Tabs, Button, etc.) replace ~800 lines of raw DOM code.
- **SDK references properly typed.** `SDK<API, Events>` instead of `any`. Removed `sendEvent` type casting hack and `(window as any).__dispatchSdk`.
- **DB layer typed.** `Record<string, unknown>` with explicit row mapping instead of untyped `any`. Probing reduced from 5 methods to 2.
- **Detection by tool ID.** Frontend looks up detection results by tool ID instead of binary name extraction (which was inconsistent with backend's smarter parsing).
- **ffuf preset.** Wordlist path changed from hardcoded `/usr/share/seclists/...` to `WORDLIST` placeholder for cross-platform compatibility.

### Fixed

- **Dispatch flow regression.** Picker, preview, and custom command dialogs are now properly mounted in App.vue and wired to the command handler.
- **`%A` trailing slash bug.** `/api/` and `/api` are different endpoints; the path is now preserved as-is.
- **Silent error swallowing.** Frontend catches replaced with error toasts in History, Settings, and batch execution.
- **Kill orphan processes.** Pipeline commands (`subfinder | httpx`, sqlmap subprocesses) are now killed as a group.
- **Quick-dispatch drift.** Per-tool context menu and command-palette entries now stay in sync with Settings changes without reloading the plugin.
- **Dark mode.** PrimeVue dark mode with theme bridge remapping `--p-surface-*` to Caido's `--c-*` native CSS variables.
- **Preview dialog sizing.** Dialog now opens at 800px width consistently; textarea no longer auto-resizes causing layout jumps.
- **Settings panel scroll.** All tabs now scroll when content overflows.
- **History freshness.** Completed runs now surface in History automatically as they finish.
- **Frontend performance.** Terminal uses `shallowRef` + in-place mutation (no Map clone per output chunk). History filters client-side without re-fetching. Picker uses O(1) index map instead of O(N^2) indexOf.

## 0.1.0

Initial release.

- 15 built-in presets (sqlmap, dalfox, ffuf, nuclei, katana, arjun, subfinder+httpx, sslscan, testssl, wpscan, droopescan, httpx, curl)
- Placeholder system (%U, %H, %P, %A, %Q, %M, %S, %C, %G, %D, %R, %E, %B)
- Preview & edit before execution
- Streaming terminal with kill support
- Multi-select batch execution
- Tool detection (installed/missing)
- Custom tools with import/export
- Run history with filters
- SQLite persistence
