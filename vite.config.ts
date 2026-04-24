/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Inject design-token variables and mixins into every SCSS file.
        // We use the legacy @import on purpose: with @use, partials would
        // need to re-import them themselves and the additionalData hook
        // can't avoid prepending to _variables.scss itself.
        additionalData: `@import "@/styles/variables"; @import "@/styles/mixins";`,
        api: "modern-compiler",
        silenceDeprecations: ["legacy-js-api", "import", "global-builtin"],
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  test: {
    // jsdom implements DOMParser with proper XML mime-type handling
    // (happy-dom parses application/xml as HTML).
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
