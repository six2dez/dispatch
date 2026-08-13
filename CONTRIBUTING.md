# Contributing to Dispatch

Thanks for taking the time to contribute. This document covers the practical
parts: how to set up the project, what CI expects, and how to land a change.

## Prerequisites

- Node.js ≥ 20 (use the version pinned in `.nvmrc`: `nvm use`)
- pnpm ≥ 9
- A Caido instance to install the built zip in for manual testing

## Setup

```sh
git clone https://github.com/six2dez/dispatch.git
cd dispatch
pnpm install
```

## Day-to-day commands

```sh
pnpm lint          # ESLint on packages/
pnpm typecheck     # tsc --noEmit across backend and frontend
pnpm test          # vitest across backend and frontend
pnpm build         # clean + build + pack into dist/plugin_package.zip
pnpm pack          # rebuild just the zip (no clean, no per-package build)
pnpm clean         # remove dist/
```

Open `dist/plugin_package.zip` from **Caido → Plugins → Install from file** to iterate
on real behavior. Caido reloads the plugin on install, so rebuild + reinstall is
the developer loop.

## Repository layout

```
dispatch/
├── manifest.json                 # Caido plugin manifest (icon, entrypoints, version)
├── scripts/pack.js               # zips manifest + icon + dist/ into plugin_package.zip
├── packages/backend/             # JS runtime inside Caido (spawns CLIs, SQLite)
│   └── src/
│       ├── executor.ts           # spawns, concurrency reservation, timeout, kill
│       ├── placeholder.ts        # %U/%H/... resolver with shell-safe escaping
│       ├── db.ts                 # SQLite wrapper (tools + history)
│       ├── detector.ts           # probes CLI binaries in PATH
│       ├── presets.ts            # built-in tool catalog
│       ├── request-data.ts       # extract bytes/headers from Caido request
│       └── index.ts              # RPC API wiring (reserveSlot → executeToolCommand)
├── packages/frontend/            # Vue 3 + PrimeVue SFCs and composables
└── .github/workflows/            # ci.yml (PR + push to main) + release.yml (tag X.Y.Z)
```

## Branching & commits

- Branch from `main`. Keep PRs focused — one concern per PR.
- Commit messages can follow Conventional Commits (`feat:`, `fix:`,
  `docs:`, `ci:`, `refactor:`, `chore:`) but it's not enforced.
- Rebase rather than merge when updating from main.

## What CI enforces

`.github/workflows/ci.yml` defines four jobs. Not all of them run on both triggers:

| Job                            | Runs on              | On a finding             |
| ------------------------------ | -------------------- | ------------------------ |
| `Lint, typecheck, test, build` | PR + push to `main`  | blocks                   |
| `Secret scan`                  | PR only              | blocks                   |
| `Secret scan (push)`           | push to `main` only  | blocks                   |
| `Dependency CVEs (advisory)`   | PR + push to `main`  | reports, never blocks    |

The two secret-scan jobs are mutually exclusive by trigger. They run the same pinned scanner
by different mechanisms because the composite action cannot resolve a scan range from a push
event — it exits 0 without scanning — so the push job runs the container over full committed
history instead. Between the two, every commit that reaches `main` is scanned by one of them,
and either one going red fails the build.

The dependency scan is advisory on purpose: a transitive CVE often has no available patch, and
blocking on one would stop an urgent fix from shipping. It reports into the run summary rather
than only into the job log, so read that summary — a green check there does not mean zero
findings.

`Lint, typecheck, test, build` runs these steps, in this order:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` — pnpm 9
3. `actions/setup-node@v4` — Node 20, pnpm cache
4. `pnpm install --frozen-lockfile`
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. `actions/upload-artifact@v4` — PR only

Steps 4–8 are the ones that fail on your change, and every one of them runs locally. Run those
five before you push and CI has nothing left to tell you.

PR builds upload `plugin_package.zip` as an artifact — reviewers can download and test
without checking out.

The release path has its own gates. `.github/workflows/release.yml` scans full committed history
for secrets before anything else, then runs lint, typecheck, `pnpm test` and build before the
package is signed. A red suite blocks a release, not just a PR.

## Tests

**Where they live.** Beside their subject, as `src/**/*.test.ts` — `placeholder.ts` is covered by
`packages/backend/src/placeholder.test.ts`. That glob is the entirety of what both
`vitest.config.ts` files collect, and it is the only place a test counts. A file outside `src/` —
in `packages/backend/test/` or `src/__tests__/`, the two conventional alternatives — is **not
collected**, and nothing tells you: the remaining files still match, so vitest reports the
surviving count and exits 0. The result is a green `pnpm test` and a green CI for a test that
never ran. Put it in `src/`, next to the module it covers.

**How to run them.** `pnpm test` runs the whole workspace. For a tight loop, filter to one
package:

```sh
pnpm --filter dispatch-backend exec vitest run src/placeholder.test.ts
pnpm --filter dispatch-backend exec vitest        # watch
```

`pnpm test` fans out through `pnpm -r run test`, which **skips** a package that defines no `test`
script instead of failing. A new workspace package is therefore untested and green by default
until you give it one.

**Platform.** The suite asserts real file modes — the temp files behind `%R`, `%E` and `%B` must
be `0600` — so it needs a POSIX filesystem and fails on native Windows for environmental reasons.
Run it under WSL, which is where `README.md` already directs Windows users to run the plugin.

## Coding conventions

- **TypeScript strict mode.** `any` is allowed as a warning but treat each case
  as a smell; prefer `unknown` + narrowing.
- **Vue SFCs.** Keep components small; extract composables into
  `packages/frontend/src/composables/` when state is shared.
- **Shell safety.** Anything that ends up inside a shell command must go
  through `shellEscape()` in `packages/backend/src/placeholder.ts`. If you add
  a new placeholder, wire it through the same single-pass replacement loop.
- **Concurrency.** If you add a new entry point that spawns a process, always
  call `reserveSlot(runId)` before the first `await` and either
  `executeToolCommand[Async](..., runId)` (which consumes the reservation) or
  `releaseSlot(runId)` on failure.
- **Caido theme.** Prefer Caido's CSS variables (`--c-bg-default`,
  `--c-fg-default`, `--c-primary`, `--c-border-default`) over hardcoded colors
  so the plugin adapts to any theme.

## Adding a built-in preset

1. Append to `DEFAULT_PRESETS` in `packages/backend/src/presets.ts`.
2. Give it a stable `id` (`preset-<tool>-<variant>`), sensible `group`, and the
   next free `sortOrder`.
3. If the tool's binary name differs from the first word of the command (e.g.
   the `subfinder + httpx` pipeline), set `detectionBinary` explicitly.
4. Update the Presets table in `README.md`.

## Changelog

The CHANGELOG follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Add your entry under the `## Unreleased` heading in the appropriate subsection
(`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`). A release PR
promotes the section and bumps `manifest.json` + `package.json` + each package
`package.json`.

## Releasing (maintainers)

1. Bump version in `manifest.json`, root `package.json`, and both
   `packages/*/package.json`.
2. Promote the `## Unreleased` section in `CHANGELOG.md` to the new version +
   today's date.
3. `git commit -am "release X.Y.Z"`, then `git tag X.Y.Z && git push origin X.Y.Z`. The tag
   carries **no `v` prefix**: `release.yml` triggers only on `[0-9]+.[0-9]+.[0-9]+`, and the
   Caido store requires the tag to equal the `manifest.json` version exactly. A `vX.Y.Z` tag
   fires nothing at all.
4. `release.yml` takes it from there — it validates the tag matches the
   manifest, builds, signs with the `PRIVATE_KEY` secret, and publishes
   `plugin_package.zip` + `.sig` + `public.pem` to GitHub Releases with notes pulled
   from the matching changelog section.
5. For emergency releases, run the workflow manually from the Actions tab
   (`workflow_dispatch`) on `main`.

## Questions

Open a GitHub Discussion or drop an issue. Security reports go through
`SECURITY.md`, not the public tracker.
