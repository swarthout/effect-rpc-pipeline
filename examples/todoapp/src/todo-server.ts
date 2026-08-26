import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import * as Effect from "effect/Effect"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { TodoRpcs, makeTodoHandlers, makeTodoStore, type TodoStore } from "./todo.js"

const readJson = (request: IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => { body += chunk })
  request.on("end", () => {
    try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
  })
  request.on("error", reject)
})

export const handleTodoPipeline = async (request: unknown, store: TodoStore) => {
  const handlers = makeTodoHandlers(store)
  const context = await Effect.runPromise(TodoRpcs.toHandlers(handlers))
  return Effect.runPromise(PipelineServer.handle(TodoRpcs, request as any, context, { id: "todo-mvc" }) as any)
}

export const createTodoHttpServer = (store = makeTodoStore()): { readonly server: Server; readonly store: TodoStore; readonly requestCount: () => number } => {
  let requests = 0
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/rpc") {
      response.writeHead(404).end()
      return
    }
    requests++
    try {
      const result = await handleTodoPipeline(await readJson(request), store)
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) }))
    }
  })
  return { server, store, requestCount: () => requests }
}
