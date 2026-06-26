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
└── .github/workflows/            # ci.yml (PRs) + release.yml (tag v*.*.*)
```

## Branching & commits

- Branch from `main`. Keep PRs focused — one concern per PR.
- Commit messages can follow Conventional Commits (`feat:`, `fix:`,
  `docs:`, `ci:`, `refactor:`, `chore:`) but it's not enforced.
- Rebase rather than merge when updating from main.

## What CI enforces

`.github/workflows/ci.yml` runs on every PR and every push to `main`:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm build`

PR builds upload `plugin_package.zip` as an artifact — reviewers can download and test
without checking out.

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
3. `git commit -am "release vX.Y.Z"` and `git tag vX.Y.Z && git push --tags`.
4. `release.yml` takes it from there — it validates the tag matches the
   manifest, builds, signs with the `PRIVATE_KEY` secret, and publishes
   `plugin_package.zip` + `.sig` + `public.pem` to GitHub Releases with notes pulled
   from the matching changelog section.
5. For emergency releases, run the workflow manually from the Actions tab
   (`workflow_dispatch`) on `main`.

## Questions

Open a GitHub Discussion or drop an issue. Security reports go through
`SECURITY.md`, not the public tracker.
