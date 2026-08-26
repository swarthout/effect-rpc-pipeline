import { createServer } from "node:http"
import * as Effect from "effect/Effect"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import { AppPipeline } from "./schema.js"
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
  const client = await Effect.runPromise(PipelineClient.make(AppPipeline, { url: "http://localhost:8787/rpc" }))
  const result = await Effect.runPromise(Pipeline.run(client, function* (rpc) {
    const session = rpc.auth.authenticate({ token: "demo-token" })
    const userId = session.getUserId()
    const profile = rpc.users.getProfile({ id: userId })
    const friends = session.getFriendIds().map((id) => ({ id, profile: rpc.users.getProfile({ id }) }))
    yield* profile
    const updated = rpc.users.updateLastSeen({ id: userId, timestamp: Date.now() })
    return { profile, friends, updated }
  }))
  console.log(JSON.stringify({ result, profileLookups, mutationCount, httpRequests: 1 }, null, 2))
  server.close()
})
