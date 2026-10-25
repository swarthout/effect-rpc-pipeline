import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/Pipeline.ts", "src/PipelineClient.ts", "src/PipelineServer.ts", "src/Capability.ts", "src/RequestBatching.ts", "src/Duplex.ts", "src/Auth.ts", "src/Sql.ts", "src/Telemetry.ts"],
  // TypeScript 7 emits declarations separately; it has no classic compiler API.
  dts: false,
  outExtensions: () => ({ js: ".js" }),
  format: ["esm"],
  target: "es2022",
  clean: true,
  sourcemap: true
})
