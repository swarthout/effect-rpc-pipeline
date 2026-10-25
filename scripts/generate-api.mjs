import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))
const check = process.argv.includes("--check")
const modules = {
  Pipeline: "Compose lazy remote calls with all, map, andThen, zipRight, and field. Data describes the plain data returned by finite pipelines. Expr, node, request and transport types describe the low-level wire protocol.",
  PipelineClient: "Create HTTP, scoped WebSocket, in-process, or custom clients. layerClient helpers install a typed client service. Protocol helpers adapt native Effect transports; transportFromHandler adapts a transport-free handler.",
  PipelineServer: "Serve HTTP and WebSocket RPC routes, or execute requests with handle. ServerOptions configures limits and lifecycle middleware. augment, layer, protocol schemas and PipelineRpc support transport adapters.",
  Capability: "Define finite capability groups with make and create instances with fromHandlers. Release remote handles with release. Predicates inspect definitions, instances and wire refs. invokeLocal, invokeWire, toRef and fromRemoteRef are adapter-level APIs.",
  Duplex: "Low-level bidirectional session protocol used by the WebSocket helpers. Most applications do not need this module. Rpcs and individual protocol RPCs, Server and ClientSession, handlers, and value transforms support custom persistent transports.",
  Auth: "Extract redacted bearer credentials, provide native server/client middleware, and assert authentication coverage. The application owns token verification and authorization. BearerOptions.maxLength defaults to 8192 characters including the scheme.",
  RequestBatching: "Create request-local partitioned caches backed by native Effect RequestResolvers. Construct each cache descriptor once in a service. Pipeline execution supplies RequestScope; native standalone RPCs can use Middleware and layer. makeScope supports custom adapters.",
  Sql: "Wrap selected pipeline graphs in an Effect SQL transaction. afterCommit registers sequential best-effort effects for a successful commit. TransactionFailed is never automatically retryable; use an application idempotency policy.",
  Telemetry: "Construct lifecycle middleware with native Effect spans and bounded metric dimensions. Tracing and metrics are enabled by default; invocation spans can be disabled independently. No payload or credential is added to telemetry."
}

await mkdir("docs/api", { recursive: true })
for (const [name, description] of Object.entries(modules)) {
  const declarations = (await readFile(`dist/${name}.d.ts`, "utf8")).trim()
  const content = `# ${name}\n\n${description}\n\nImport from \`effect-rpc-pipeline/${name}\`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).\n\nThese signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with \`npm run docs:generate\`.\n\n\`\`\`ts\n${declarations}\n\`\`\`\n`
  if (check) {
    if (await readFile(`docs/api/${name}.md`, "utf8") !== content) throw new Error(`Stale API reference: ${name}; run npm run docs:generate`)
  } else await writeFile(`docs/api/${name}.md`, content)
}

// Keep README examples identical to the files checked by TypeScript.
let readme = await readFile("README.md", "utf8")
const snippets = []
for (const name of ["rpcs", "server", "client"]) {
  snippets.push([name, (await readFile(`docs/snippets/${name}.ts`, "utf8")).trim()])
}
const overview = await readFile("docs/snippets/overview.ts", "utf8")
for (const match of overview.matchAll(/\/\/ snippet:([^:]+):start\n([\s\S]*?)\n\s*\/\/ snippet:\1:end/g)) {
  const lines = match[2].split("\n")
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length))
  snippets.push([match[1], lines.map((line) => line.slice(indent)).join("\n").trim()])
}
for (const [name, code] of snippets) {
  const start = `<!-- snippet:${name}:start -->`
  const end = `<!-- snippet:${name}:end -->`
  const block = `${start}\n\`\`\`ts\n${code}\n\`\`\`\n${end}`
  const first = readme.indexOf(start)
  const last = readme.indexOf(end)
  if (first < 0 || last < first) throw new Error(`Missing README snippet markers: ${name}`)
  const previous = readme.slice(first, last + end.length)
  if (check && previous !== block) throw new Error(`Stale README snippet: ${name}`)
  readme = readme.slice(0, first) + block + readme.slice(last + end.length)
}
if (!check) await writeFile("README.md", readme)
console.log(check ? "API reference and README snippets are current" : "Updated API reference and README snippets")
