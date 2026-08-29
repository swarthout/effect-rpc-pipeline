import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/vitest-setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
    server: { deps: { inline: ["foldkit", "@foldkit/ui", "@foldkit/devtools"] } }
  }
})
