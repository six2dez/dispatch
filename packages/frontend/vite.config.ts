import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "plugin-frontend",
      fileName: () => "script.js",
      formats: ["es"],
    },
    outDir: "../../dist/frontend",
    minify: false,
    rollupOptions: {
      external: [
        /^caido:/,
        /^@caido\//,
      ],
      output: {
        assetFileNames: "style[extname]",
      },
    },
  },
});
