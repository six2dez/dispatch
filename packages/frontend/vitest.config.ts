// This file is mandatory, not optional: with no vitest config present the runner
// falls back to vite.config.ts, which would boot the whole CSS pipeline and apply
// the production define to test code as a literal source substitution.
// environment "node" per D-04 — no DOM library in this phase. Phase 5 adds one when
// it needs to mount components.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
