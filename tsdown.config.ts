import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/Pipeline.ts", "src/PipelineClient.ts", "src/PipelineServer.ts", "src/Capability.ts", "src/RequestBatching.ts"],
  dts: true,
  format: ["esm"],
  clean: true,
  sourcemap: true
})
