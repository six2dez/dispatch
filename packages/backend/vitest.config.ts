// This file is mandatory, not optional: with no vitest config present the runner
// falls back to vite.config.ts and transforms test code through the library-build
// pipeline. Only the test key belongs here — nothing from the build config.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Collection is scoped to src/, where every test sits beside the module it covers.
    // A test file outside src/ — packages/backend/test/, src/__tests__/ — is simply
    // not collected, and the run does not say so: the remaining files still match, so
    // vitest reports the surviving count and exits 0. That makes a test which never
    // ran indistinguishable from a passing one, locally and in CI. Only the empty case
    // fails loudly, and it is not the one that happens. The scope stays narrow because
    // src/ is also the only path tsconfig typechecks and eslint lints, so a second
    // collection root would be unchecked by both. Stated again in CONTRIBUTING.md.
    include: ["src/**/*.test.ts"],
  },
});
