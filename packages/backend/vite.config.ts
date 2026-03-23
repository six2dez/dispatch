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
      external: [
        /^caido:/,
        "child_process",
        "fs",
        "os",
        "path",
      ],
    },
  },
});
