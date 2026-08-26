import { createServer } from "node:http"
import * as Effect from "effect/Effect"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import { AppRpcs } from "./schema.js"
import { handlePipeline, mutationCount, profileLookups } from "./server.js"

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/rpc") {
    response.writeHead(404).end()
    return
  }
  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => { body += chunk })
  request.on("end", async () => {
    try {
      const result = await handlePipeline(JSON.parse(body))
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) }))
    }
  })
})

server.listen(8787, async () => {
  const client = await Effect.runPromise(PipelineClient.make(AppRpcs, {
    id: "example-app",
    transport: (pipeline) => Effect.tryPromise({
      try: () => fetch("http://localhost:8787/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pipeline)
      }).then((response) => response.json()),
      catch: (error) => error
    }) as any
  }))
  const session = client.authenticate({ token: "demo-token" })
  const userId = session.getUserId()
  const profile = client.getUserProfile({ id: userId })
  const friends = Pipeline.map(session.getFriendIds(), (id) => ({ id, profile: client.getUserProfile({ id }) }))
  const updated = Pipeline.zipRight(profile, client.updateLastSeen({ id: userId, timestamp: Date.now() }))
  const result = await Effect.runPromise(Pipeline.all({ profile, friends, updated }))
  console.log(JSON.stringify({ result, profileLookups, mutationCount, httpRequests: 1 }, null, 2))
  server.close()
})
