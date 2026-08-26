import * as Effect from "effect/Effect"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { makeTodoState, TodoRpcs, type Todo, type TodoFilter, type TodoState } from "./todo.js"

export type TodoClient = {
  readonly snapshot: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly add: (title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggle: (todo: Pick<Todo, "id" | "completed">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggleAll: (completed: boolean, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly edit: (todo: Pick<Todo, "id">, title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly remove: (todo: Pick<Todo, "id">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly clearCompleted: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
}

export const makeTodoClient = (url: string): Effect.Effect<TodoClient> => Effect.gen(function*() {
  const rpc = yield* PipelineClient.make(TodoRpcs, { url, id: "todo-mvc" })

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
})
