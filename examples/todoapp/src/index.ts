import { createServer } from "node:http"
import * as Effect from "effect/Effect"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { AppRpcs } from "./schema.js"
import { handlePipeline, mutationCount, profileLookups } from "./server.js"
import { clientAuthLayer, makeAccessToken } from "./todo-auth.js"

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
      const result = await handlePipeline(JSON.parse(body), request.headers.authorization)
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) }))
    }
  })
})

server.listen(8787, async () => {
  const token = await makeAccessToken({ id: "usr_100", name: "Ada" })
  const client = await Effect.runPromise(PipelineClient.make(AppRpcs, {
    id: "example-app",
    transport: (pipeline, options) => Effect.tryPromise({
      try: () => fetch("http://localhost:8787/rpc", {
        method: "POST",
        headers: { ...options?.headers, "content-type": "application/json" },
        body: JSON.stringify(pipeline)
      }).then((response) => response.json()),
      catch: (error) => error
    }) as any
  }).pipe(Effect.provide(clientAuthLayer(token))))
  const session = client.openSession()
  const userId = session.getUserId()
  const profile = client.getUserProfile({ id: userId })
  const friends = Pipeline.map(session.getFriendIds(), (id) => ({ id, profile: client.getUserProfile({ id }) }))
  const updated = Pipeline.zipRight(profile, client.updateLastSeen({ id: userId, timestamp: Date.now() }))
  const result = await Effect.runPromise(Pipeline.all({ profile, friends, updated }))
  console.log(JSON.stringify({ result, profileLookups, mutationCount, httpRequests: 1 }, null, 2))
  server.close()
})
