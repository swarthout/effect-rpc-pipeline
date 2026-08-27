import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Headers from "effect/unstable/http/Headers"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as PipelineServer from "effect-rpc-pipeline/PipelineServer"
import { AccessTokenVerifierLive, AuthenticatedLive } from "./todo-auth.js"
import { AppRpcs, makeTodoHandlers, makeTodoStore, type TodoStore } from "./todo.js"

const readJson = (request: IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
  let body = ""
  request.setEncoding("utf8")
  request.on("data", (chunk) => { body += chunk })
  request.on("end", () => {
    try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
  })
  request.on("error", reject)
})

export const handleTodoPipeline = async (request: unknown, store: TodoStore, authorization?: string) => Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const handlers = yield* AppRpcs.toHandlers(makeTodoHandlers(store)).pipe(Effect.provide(AccessTokenVerifierLive))
    const auth = yield* Layer.build(Layer.merge(AuthenticatedLive, AccessTokenVerifierLive))
    const context = Context.merge(handlers, auth)
    return yield* PipelineServer.handle(AppRpcs, request as any, {
      id: "todo-mvc",
      metadata: {
        client: new Rpc.ServerClient(1),
        requestId: "todo-http",
        headers: Headers.fromInput({ authorization })
      }
    }).pipe(Effect.provideContext(context)) as any
  })) as Effect.Effect<any, unknown, never>
)

export const createTodoHttpServer = (store = makeTodoStore()): { readonly server: Server; readonly store: TodoStore; readonly requestCount: () => number } => {
  let requests = 0
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST" || request.url !== "/rpc") {
      response.writeHead(404).end()
      return
    }
    requests++
    try {
      const result = await handleTodoPipeline(await readJson(request), store, request.headers.authorization)
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) }))
    }
  })
  return { server, store, requestCount: () => requests }
}
