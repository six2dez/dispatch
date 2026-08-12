// This file is mandatory, not optional: with no vitest config present the runner
// falls back to vite.config.ts and transforms test code through the library-build
// pipeline. Only the test key belongs here — nothing from the build config.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
