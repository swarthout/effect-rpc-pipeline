import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, writeFile, copyFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { build } from "vite"

const root = resolve(".")
const manifest = JSON.parse(await readFile("package.json", "utf8"))
const work = await mkdtemp(join(tmpdir(), "effect-rpc-consumer-"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const run = (file, args, cwd = work) => execFileSync(file, args, { cwd, stdio: "inherit", timeout: 120_000 })
try {
  const packed = JSON.parse(execFileSync(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", work], { cwd: root, encoding: "utf8" }))[0]
  for (const file of packed.files) {
    if (!/^(dist\/|src\/|docs\/|README\.md$|LICENSE$|CHANGELOG\.md$|CONTRIBUTING\.md$|SECURITY\.md$|package\.json$)/.test(file.path)) throw new Error(`Unexpected package file: ${file.path}`)
    if (file.path.includes("node_modules/") || file.path.includes(".data/")) throw new Error(`Private package file: ${file.path}`)
  }
  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry)) if (!packed.files.some((file) => file.path === target.slice(2))) throw new Error(`Missing exported artifact: ${target}`)
  }
  await writeFile(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }))
  run(npm, ["install", "--no-package-lock", "--ignore-scripts", "--no-fund", "--no-audit", join(work, packed.filename), `effect@${manifest.devDependencies.effect}`, `@effect/platform-node@${manifest.devDependencies["@effect/platform-node"]}`, `@types/node@${manifest.devDependencies["@types/node"]}`])
  const imports = Object.keys(manifest.exports).map((key) => key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`)
  await writeFile(join(work, "exports.mjs"), `for (const name of ${JSON.stringify(imports)}) { const value = await import(name); if (!Object.keys(value).length) throw new Error(name); }\nconsole.log("All root/subpath runtime exports resolve")\n`)
  run(process.execPath, ["exports.mjs"])
  await copyFile("scripts/fixtures/packed-consumer.ts", join(work, "consumer.ts"))
  await writeFile(join(work, "exports.ts"), imports.map((name, i) => `import * as Module${i} from ${JSON.stringify(name)}; void Module${i};`).join("\n"))
  run(resolve("node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "consumer.ts", "exports.ts"])
  run(process.execPath, ["consumer.ts"])
  // Compile the README files using the same isolated consumer installation.
  await mkdir(join(work, "quickstart"))
  for (const name of ["rpcs", "server", "client"]) await copyFile(`docs/snippets/${name}.ts`, join(work, "quickstart", `${name}.ts`))
  run(resolve("node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "quickstart/server.ts", "quickstart/client.ts"])
  await writeFile(join(work, "browser.ts"), `export { Pipeline, PipelineClient, PipelineServer, Capability, Duplex, Auth, RequestBatching, Sql, Telemetry } from "effect-rpc-pipeline";`)
  const warnings = []
  await build({
    root: work,
    configFile: false,
    logLevel: "silent",
    build: { lib: { entry: join(work, "browser.ts"), formats: ["es"], fileName: "browser" }, outDir: join(work, "browser-dist"),
      rolldownOptions: { onwarn(warning) { warnings.push(String(warning.message)) } } }
  })
  if (warnings.some((warning) => /externalized for browser|node:|could not resolve/i.test(warning))) throw new Error(warnings.join("\n"))
  console.log(`Packed ${packed.files.length} files; all runtime/types exports, transport smoke tests, README compilation and browser bundling passed`)
} finally {
  await rm(work, { recursive: true, force: true })
}
