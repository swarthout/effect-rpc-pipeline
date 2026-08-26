import * as Effect from "effect/Effect"
import * as Pipeline from "effect-rpc-pipeline/Pipeline"
import * as PipelineClient from "effect-rpc-pipeline/PipelineClient"
import { makeTodoState, TodoPipeline, type Todo, type TodoFilter, type TodoState } from "./todo.js"

export type TodoClient = {
  readonly snapshot: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly add: (title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggle: (todo: Pick<Todo, "id" | "completed">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly toggleAll: (completed: boolean, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly edit: (todo: Pick<Todo, "id">, title: string, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly remove: (todo: Pick<Todo, "id">, filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
  readonly clearCompleted: (filter?: TodoFilter) => Effect.Effect<TodoState, unknown>
}

export const makeTodoClient = (url: string): Effect.Effect<TodoClient> =>
  Effect.map(PipelineClient.make(TodoPipeline, { url }), (client) => {
    const state = (filter: TodoFilter) => Pipeline.resolve(client, (rpc) => ({
      todos: rpc.todos.list({ filter }),
      remaining: rpc.todos.count({ filter: "active" })
    })).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining)))
    return {
      snapshot: (filter = "all") => state(filter),
      add: (title, filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.add({ title })
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))),
      toggle: (todo, filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.toggle({ id: todo.id, completed: !todo.completed })
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))),
      toggleAll: (completed, filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.toggleAll({ completed })
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))),
      edit: (todo, title, filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.update({ id: todo.id, title })
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))),
      remove: (todo, filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.delete({ id: todo.id })
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining))),
      clearCompleted: (filter = "all") => Pipeline.run(client, function* (rpc) {
        yield* rpc.todos.clearCompleted()
        return yield* Pipeline.all({
          todos: rpc.todos.list({ filter }),
          remaining: rpc.todos.count({ filter: "active" })
        })
      }).pipe(Effect.map(({ todos, remaining }) => makeTodoState(todos, filter, remaining)))
    }
  })
