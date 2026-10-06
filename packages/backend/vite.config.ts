import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "plugin-backend",
      fileName: () => "script.js",
      formats: ["es"],
    },
    outDir: "../../dist/backend",
    minify: false,
    rollupOptions: {
      // Node built-ins the backend imports. "crypto" joined the list with the temp
      // directory suffix fix: randomBytes generates that name, and an import left out
      // here is resolved to vite's browser-external stub, which fails the build rather
      // than shipping a name built from Math.random.
      external: [
        /^caido:/,
        "child_process",
        "crypto",
        "fs",
        "os",
        "path",
      ],
    },
  },
});
