import { foldkit } from "@foldkit/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [foldkit({ devToolsMcpPort: 9988, ssr: { serverEntry: "/src/entry.server.ts" } })],
  server: {
    port: 5174,
    proxy: {
      "/rpc": "http://127.0.0.1:8788",
      "/session": "http://127.0.0.1:8788"
    }
  }
})
