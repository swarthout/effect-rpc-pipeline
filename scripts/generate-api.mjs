import { readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))
const check = process.argv.includes("--check")
const modules = {
  Pipeline: `Build a graph of remote calls and choose the data it returns. A remote value is lazy until run as an Effect.

## Common tasks

| Task | API |
| --- | --- |
| Select several results in one request | \`all\` |
| Repeat calls for array items or an Option value | \`map\` |
| Wait for earlier work before starting a new phase | \`andThen\`, \`zipRight\` |
| Read a field whose name is reserved | \`field\` |
| Describe a finite result without class methods | \`Data<A>\` |

\`Remote\` describes a future result. The expression, node, request, and transport types support custom adapters.`,
  PipelineClient: `Create a typed client from an Effect RPC group. Choose the transport and lifetime that fit the caller.

## Common tasks

| Task | API |
| --- | --- |
| Execute finite graphs over HTTP | \`makeHttp\` |
| Use a shared connection for calls, streams, and handles | \`makeWebSocket\` |
| Run through the server in the same process | \`makeInProcess\` |
| Provide a client as an Effect service | \`layerClient*\` helpers |
| Supply a custom transport | \`make\`, protocol helpers, \`transportFromHandler\` |

HTTP clients are reusable. WebSocket clients need an owning scope. In-process clients support finite graphs.`,
  PipelineServer: `Serve pipeline requests or execute them directly in the same process.

## Common tasks

| Task | API |
| --- | --- |
| Install an HTTP route | \`layerHttp\` |
| Install a WebSocket route | \`layerWebSocket\` |
| Validate and execute a request directly | \`handle\` |
| Set work limits and middleware | \`ServerOptions\` |
| Wrap request, execution, or invocation work | \`makeMiddleware\` |

Adapter authors can use \`augment\`, \`layer\`, protocol schemas, and \`PipelineRpc\` for lower-level integration.`,
  Capability: `Define a set of methods tied to one implementation, such as a session, document handle, or client callback.

## Common tasks

1. Call \`make\` with a definition ID and RPC group.
2. Use the definition's \`schema\` in an RPC payload or result.
3. Create an implementation with \`fromHandlers\`.
4. Release a remote handle with \`release\` when it is no longer needed.

Predicates inspect definitions, instances, and wire references. \`invokeLocal\`, \`invokeWire\`, \`toRef\`, and \`fromRemoteRef\` support custom adapters.`,
  Duplex: `Implement the bidirectional session protocol used by the WebSocket helpers. Most applications can use PipelineClient and PipelineServer without importing this module.

## Adapter APIs

- \`Rpcs\` and the individual protocol RPCs define the session messages.
- \`Server\` and \`ClientSession\` manage the two sides of a session.
- Handlers and value transforms connect capabilities to a persistent transport.`,
  Auth: `Connect bearer credentials to native Effect RPC middleware. Your application verifies tokens and decides what the caller may do.

## Common tasks

| Task | API |
| --- | --- |
| Extract a redacted bearer credential | \`bearerToken\` |
| Supply a principal from your token verifier | \`layerBearer\` |
| Read the current credential for each client execution | \`layerClientBearer\` |
| Check that each RPC is explicitly public or protected | \`assertCoverage\` |

\`BearerOptions.maxLength\` defaults to 8,192 characters, including the scheme.`,
  RequestBatching: `Collect backend reads into batches and reuse results within one request. The resolver must perform a real bulk operation.

## Common tasks

1. Construct a \`cache\` descriptor once in a service or module.
2. Use it from handlers to collect concurrent lookups.
3. Partition it by principal or tenant when a graph uses several identities.

Pipeline execution supplies \`RequestScope\`. For standalone native RPCs, apply \`Middleware\` and provide \`layer\`. Custom adapters can create a scope with \`makeScope\`.`,
  Sql: `Run a finite pipeline in an Effect SQL transaction and schedule work after a successful commit.

## Common tasks

- Add \`transaction()\` to server middleware to wrap a graph in one transaction.
- Use \`transaction({ when })\` to choose which graphs need it.
- Call \`afterCommit\` inside a transactional handler to register best-effort follow-up effects.

After-commit effects run sequentially. For durable delivery, use an outbox.

\`TransactionFailed\` has \`retryable: false\` because the commit outcome may be unknown. Add application idempotency before replaying a mutation.`,
  Telemetry: `Add Effect tracing and metrics around pipeline execution.

## Common tasks

- Call \`make()\` and add the result to server middleware.
- Configure tracing and metrics separately, or set either to \`false\`.
- Disable invocation spans independently when only graph-level tracing is needed.

Tracing and metrics are enabled by default. Metric dimensions are bounded; payloads and credentials are excluded.`
}

await mkdir("docs/api", { recursive: true })
for (const [name, description] of Object.entries(modules)) {
  const declarations = (await readFile(`dist/${name}.d.ts`, "utf8")).trim()
  const content = `# ${name}\n\n${description}\n\nImport from \`effect-rpc-pipeline/${name}\`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).\n\n## Complete signatures\n\nThese signatures come from the package declarations. Relative imports refer to other package modules.\n\n\`\`\`ts\n${declarations}\n\`\`\`\n`
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

const narrativeSnippets = new Map()
for (const [path, prefix] of [["docs/snippets/concepts.ts", "narrative"], ["docs/snippets/homepage.ts", "homepage"]]) {
  const source = await readFile(path, "utf8")
  const pattern = new RegExp(`// ${prefix}:(\\w+):start\\n([\\s\\S]*?)\\n\\s*// ${prefix}:\\1:end`, "g")
  for (const match of source.matchAll(pattern)) {
    const lines = match[2].split("\n")
    const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^\s*/)[0].length))
    narrativeSnippets.set(match[1], lines.map(line => line.slice(indent)).join("\n").trim())
  }
}
const narrativePath = "docs/guides/how-pipelines-work.md"
let narrative = await readFile(narrativePath, "utf8")
for (const [name, sourceName] of [["sequential", "sequential"], ["selection", "query"], ["map", "map"], ["mutation", "mutation"], ["adoption", "adoption"], ["services", "services"]]) {
  const code = narrativeSnippets.get(sourceName)
  if (!code) throw new Error(`Missing narrative source snippet: ${sourceName}`)
  const start = `<!-- narrative:${name}:start -->`
  const end = `<!-- narrative:${name}:end -->`
  const first = narrative.indexOf(start)
  const last = narrative.indexOf(end)
  if (first < 0 || last < first) throw new Error(`Missing narrative snippet markers: ${name}`)
  const block = `${start}\n\`\`\`ts\n${code}\n\`\`\`\n${end}`
  if (check && narrative.slice(first, last + end.length) !== block) throw new Error(`Stale narrative snippet: ${name}; run npm run docs:generate`)
  narrative = narrative.slice(0, first) + block + narrative.slice(last + end.length)
}
if (!check) await writeFile(narrativePath, narrative)
console.log(check ? "API reference, README, and narrative snippets are current" : "Updated API reference, README, and narrative snippets")
