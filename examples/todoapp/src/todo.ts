import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"

export const TodoFilter = Schema.Union([
  Schema.Literal("all"),
  Schema.Literal("active"),
  Schema.Literal("completed")
])
export type TodoFilter = Schema.Schema.Type<typeof TodoFilter>

export class Todo extends Schema.Class<Todo>("Todo")({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  order: Schema.Number,
  createdAt: Schema.Number
}) {}

export const TodoRpcs = RpcGroup.make(
  Rpc.make("listTodos", {
    payload: { filter: TodoFilter },
    success: Schema.Array(Todo)
  }),
  Rpc.make("addTodo", {
    payload: { title: Schema.String },
    success: Todo
  }),
  Rpc.make("toggleTodo", {
    payload: { id: Schema.String, completed: Schema.Boolean },
    success: Todo
  }),
  Rpc.make("toggleAllTodos", {
    payload: { completed: Schema.Boolean },
    success: Schema.Array(Todo)
  }),
  Rpc.make("updateTodo", {
    payload: { id: Schema.String, title: Schema.String },
    success: Todo
  }),
  Rpc.make("deleteTodo", {
    payload: { id: Schema.String },
    success: Schema.Boolean
  }),
  Rpc.make("clearCompletedTodos", {
    success: Schema.Number
  }),
  Rpc.make("countTodos", {
    payload: { filter: TodoFilter },
    success: Schema.Number
  })
)

export type TodoState = {
  readonly todos: ReadonlyArray<Todo>
  readonly filter: TodoFilter
  readonly remaining: number
}

export type TodoStore = {
  readonly list: (filter: TodoFilter) => ReadonlyArray<Todo>
  readonly add: (title: string) => Todo
  readonly toggle: (id: string, completed: boolean) => Todo
  readonly toggleAll: (completed: boolean) => ReadonlyArray<Todo>
  readonly update: (id: string, title: string) => Todo
  readonly remove: (id: string) => boolean
  readonly clearCompleted: () => number
}

export const makeTodoStore = (): TodoStore => {
  const todos = new Map<string, Todo>()
  let sequence = 0
  const find = (id: string) => {
    const todo = todos.get(id)
    if (!todo) throw new Error(`Todo not found: ${id}`)
    return todo
  }
  const normalize = (title: string) => title.trim()
  return {
    list: (filter) => [...todos.values()]
      .filter((todo) => filter === "all" || (filter === "active" ? !todo.completed : todo.completed))
      .sort((a, b) => a.order - b.order),
    add: (title) => {
      const normalized = normalize(title)
      if (normalized.length === 0) throw new Error("Todo title cannot be empty")
      const now = Date.now()
      const todo = new Todo({ id: `todo-${++sequence}`, title: normalized, completed: false, order: sequence, createdAt: now })
      todos.set(todo.id, todo)
      return todo
    },
    toggle: (id, completed) => {
      const todo = find(id)
      const updated = new Todo({ ...todo, completed })
      todos.set(id, updated)
      return updated
    },
    toggleAll: (completed) => {
      for (const todo of todos.values()) todos.set(todo.id, new Todo({ ...todo, completed }))
      return [...todos.values()].sort((a, b) => a.order - b.order)
    },
    update: (id, title) => {
      const normalized = normalize(title)
      if (normalized.length === 0) {
        todos.delete(id)
        throw new Error("Todo title cannot be empty")
      }
      const updated = new Todo({ ...find(id), title: normalized })
      todos.set(id, updated)
      return updated
    },
    remove: (id) => todos.delete(id),
    clearCompleted: () => {
      let removed = 0
      for (const [id, todo] of todos) if (todo.completed) { todos.delete(id); removed++ }
      return removed
    }
  }
}

const makeTodoRepository = (store: TodoStore) => ({
  list: (filter: TodoFilter) => Effect.sync(() => store.list(filter)),
  add: (title: string) => Effect.sync(() => store.add(title)),
  toggle: (id: string, completed: boolean) => Effect.sync(() => store.toggle(id, completed)),
  toggleAll: (completed: boolean) => Effect.sync(() => store.toggleAll(completed)),
  update: (id: string, title: string) => Effect.sync(() => store.update(id, title)),
  remove: (id: string) => Effect.sync(() => store.remove(id)),
  clearCompleted: () => Effect.sync(() => store.clearCompleted())
})

export const makeTodoHandlers = (store: TodoStore) => {
  const repository = makeTodoRepository(store)
  return TodoRpcs.of({
    listTodos: ({ filter }) => Effect.gen(function*() {
      return yield* repository.list(filter)
    }),
    addTodo: ({ title }) => Effect.gen(function*() {
      return yield* repository.add(title)
    }),
    toggleTodo: ({ id, completed }) => Effect.gen(function*() {
      return yield* repository.toggle(id, completed)
    }),
    toggleAllTodos: ({ completed }) => Effect.gen(function*() {
      return yield* repository.toggleAll(completed)
    }),
    updateTodo: ({ id, title }) => Effect.gen(function*() {
      return yield* repository.update(id, title)
    }),
    deleteTodo: ({ id }) => Effect.gen(function*() {
      return yield* repository.remove(id)
    }),
    clearCompletedTodos: () => Effect.gen(function*() {
      return yield* repository.clearCompleted()
    }),
    countTodos: ({ filter }) => Effect.gen(function*() {
      return (yield* repository.list(filter)).length
    })
  })
}

export const makeTodoState = (todos: ReadonlyArray<Todo>, filter: TodoFilter, remaining: number): TodoState => ({ todos, filter, remaining })
