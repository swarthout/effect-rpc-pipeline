import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import type { PipelineRequest } from "effect-rpc-pipeline/Pipeline"
import { AppRpcs, makeTodoState, type Todo, type TodoEvent, type TodoFilter, type TodoState } from "./todo.js"
import { clientAuthLayer } from "./todo-auth.js"

export type TodoClient = {
  readonly snapshot: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly add: (title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggle: (todo: Pick<Todo, "id" | "completed">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggleAll: (completed: boolean, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly edit: (todo: Pick<Todo, "id">, title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly remove: (todo: Pick<Todo, "id">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly clearCompleted: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
}

export type LiveTodoClient = TodoClient & {
  readonly watch: (filter?: TodoFilter) => Stream.Stream<TodoEvent, unknown>
}

type TodoRpcClient = Pipeline.ClientApi<RpcGroup.Rpcs<typeof AppRpcs>>

const fromRpc = (rpc: TodoRpcClient): TodoClient => {

  const query = (filter: TodoFilter) => Pipeline.all({
    todos: rpc.listTodos({ filter }),
    remaining: rpc.countTodos({ filter: "active" })
  }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining)))

  const mutateThenQuery = (mutation: Pipeline.Remote<unknown>, filter: TodoFilter) => mutation.pipe(
    Pipeline.andThen(() => ({
      todos: rpc.listTodos({ filter }),
      remaining: rpc.countTodos({ filter: "active" })
    })),
    Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))
  )

  return {
    snapshot: (filter = "all") => query(filter),
    add: (title, filter = "all") => mutateThenQuery(rpc.addTodo({ title }), filter),
    toggle: (todo, filter = "all") => mutateThenQuery(rpc.toggleTodo({ id: todo.id, completed: !todo.completed }), filter),
    toggleAll: (completed, filter = "all") => mutateThenQuery(rpc.toggleAllTodos({ completed }), filter),
    edit: (todo, title, filter = "all") => mutateThenQuery(rpc.updateTodo({ id: todo.id, title }), filter),
    remove: (todo, filter = "all") => mutateThenQuery(rpc.deleteTodo({ id: todo.id }), filter),
    clearCompleted: (filter = "all") => mutateThenQuery(rpc.clearCompletedTodos(), filter)
  }
}

const httpTransport = (url: string): Pipeline.PipelineTransport => (request: PipelineRequest, options) => Effect.tryPromise({
  try: async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...options?.headers, "content-type": "application/json" },
      body: JSON.stringify(request)
    })
    if (!response.ok) throw new Error(`Todo pipeline HTTP ${response.status}`)
    return await response.json()
  },
  catch: (error) => error
}) as any

/** TodoMVC facade for the standalone raw-HTTP example server. */
export const makeTodoClient = (url: string, token: string): Effect.Effect<TodoClient> => Effect.map(
  PipelineClient.make(AppRpcs, { transport: httpTransport(url), id: "todo-mvc" }).pipe(Effect.provide(clientAuthLayer(token))),
  fromRpc
)

/** Native client for use inside a PipelineClient HTTP or WebSocket layer scope. */
export const makeLiveTodoClient = (token: string) => Effect.map(
  PipelineClient.make(AppRpcs, { id: "todo-mvc" }).pipe(Effect.provide(clientAuthLayer(token))),
  (rpc) => ({ ...fromRpc(rpc), watch: (filter: TodoFilter = "all") => rpc.watchTodos({ filter }) })
)
