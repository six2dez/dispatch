import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
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
