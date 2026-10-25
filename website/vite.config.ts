import { defineConfig } from "vite"
import { foldkit } from "@foldkit/vite-plugin"

export default defineConfig({
  base: process.env.SITE_BASE ?? "/effect-rpc-pipeline/",
  plugins: [foldkit({ ssr: { serverEntry: "/src/entry.server.ts" } })],
  define: {
    "import.meta.env.FOLDKIT_BUILD_ID": JSON.stringify(process.env.GITHUB_SHA ?? "local"),
    "import.meta.env.SITE_ORIGIN": JSON.stringify(
      process.env.SITE_ORIGIN ?? "https://swarthout.github.io",
    ),
  },
  server: { port: 4173 },
  preview: { port: 4173 },
})
