import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import manifest from "./manifest.config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Relative asset URLs are required for chrome-extension:// pages.
  // Absolute "/assets/..." paths resolve incorrectly in extension contexts.
  base: "./",
  plugins: [react(), crx({ manifest })],
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(rootDir, "index.html"),
        options: resolve(rootDir, "options.html"),
      },
    },
  },
});
