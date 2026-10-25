import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test",
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium" },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4173/effect-rpc-pipeline/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
