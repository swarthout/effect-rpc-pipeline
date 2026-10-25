import { foldkit } from "@foldkit/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [foldkit({ devToolsMcpPort: 9988, ssr: { serverEntry: "/src/entry.server.ts" } })],
  // Keep capability registrations inside Vite's SSR module lifecycle so a
  // config restart cannot reuse an old registry with new definition modules.
  ssr: { noExternal: ["effect-rpc-pipeline"] },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/rpc": { target: "http://127.0.0.1:8788", ws: true, changeOrigin: false },
      "/session": { target: "http://127.0.0.1:8788", changeOrigin: false }
    }
  }
})
