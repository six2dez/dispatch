import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import prefixwrap from "postcss-prefixwrap";
import tailwindcss from "tailwindcss";
import tailwindPrimeui from "tailwindcss-primeui";
// @ts-expect-error no declared types at this time
import tailwindCaido from "@caido/tailwindcss";

export default defineConfig({
  plugins: [vue()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  css: {
    postcss: {
      plugins: [
        // Wrap every selector authored by the plugin under our scope class so
        // the plugin's CSS can never leak into (or be overridden by) Caido's
        // UI. The class is set on both DOM trees the plugin owns: the page
        // body and the overlay host that PrimeVue dialogs teleport into (see
        // src/index.ts).
        // This runs BEFORE tailwind on purpose: it only scopes the authored
        // CSS. The tailwind utilities generated afterwards stay global, which
        // is harmless — preflight is disabled so there are no element resets,
        // and utilities are class-scoped and idempotent.
        prefixwrap(".plugin--dispatch"),
        tailwindcss({
          corePlugins: {
            // Never reset global element styles — that would alter Caido.
            preflight: false,
          },
          content: [
            "./src/**/*.{vue,ts}",
            "./node_modules/@caido/primevue/dist/primevue.mjs",
          ],
          // Caido core sets [data-mode="dark"] on <html> to drive dark mode.
          darkMode: ["selector", '[data-mode="dark"]'],
          plugins: [tailwindPrimeui, tailwindCaido],
        }),
      ],
    },
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
      // Caido injects the frontend SDK at runtime; everything else
      // (Vue, PrimeVue, @caido/primevue) is bundled into the plugin.
      external: [
        /^caido:/,
        "@caido/sdk-frontend",
      ],
      output: {
        assetFileNames: "style[extname]",
      },
    },
  },
});
