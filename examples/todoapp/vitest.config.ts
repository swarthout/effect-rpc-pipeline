import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// The example consumes the package through a local symlink. Deduping Effect
// mirrors a published installation, where the package resolves its peer from
// the consuming application.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: {
    alias: [
      {
        find: /^effect\/(.+)$/,
        replacement: `${fileURLToPath(new URL("../../node_modules/effect/dist", import.meta.url))}/$1.js`
      },
      {
        find: /^effect$/,
        replacement: fileURLToPath(new URL("../../node_modules/effect/dist/index.js", import.meta.url))
      }
    ]
  }
})
