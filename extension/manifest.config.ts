import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "SEO Audit",
  description: "Crawl and audit websites for SEO issues — full-tab dashboard.",
  version: "0.1.0",
  action: {},
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  options_page: "options.html",
  permissions: ["activeTab", "scripting", "storage", "tabs", "downloads"],
  host_permissions: [
    "http://127.0.0.1:8000/*",
    "http://localhost:8000/*",
    "http://*/*",
    "https://*/*",
  ],
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
});
