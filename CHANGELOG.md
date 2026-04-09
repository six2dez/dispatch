# Changelog

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
