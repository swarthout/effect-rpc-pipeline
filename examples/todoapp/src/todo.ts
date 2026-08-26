import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
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

export class InvalidTodoTitle extends Schema.TaggedError<InvalidTodoTitle>()("InvalidTodoTitle", {
  title: Schema.String
}) {}

export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
  id: Schema.String
}) {}

export const TodoChangeKind = Schema.Union([
  Schema.Literal("created"),
  Schema.Literal("updated"),
  Schema.Literal("deleted"),
  Schema.Literal("reset")
])

export class TodoEvent extends Schema.Class<TodoEvent>("TodoEvent")({
  version: Schema.Number,
  kind: TodoChangeKind,
  todos: Schema.Array(Todo)
}) {}

export const TodoRpcs = RpcGroup.make(
  Rpc.make("listTodos", {
    payload: { filter: TodoFilter },
    success: Schema.Array(Todo)
  }),
  Rpc.make("addTodo", {
    payload: { title: Schema.String },
    success: Todo,
    error: InvalidTodoTitle
  }),
  Rpc.make("toggleTodo", {
    payload: { id: Schema.String, completed: Schema.Boolean },
    success: Todo,
    error: TodoNotFound
  }),
  Rpc.make("toggleAllTodos", {
    payload: { completed: Schema.Boolean },
    success: Schema.Array(Todo)
  }),
  Rpc.make("updateTodo", {
    payload: { id: Schema.String, title: Schema.String },
    success: Todo,
    error: Schema.Union([TodoNotFound, InvalidTodoTitle])
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
  }),
  Rpc.make("watchTodos", {
    payload: { filter: TodoFilter },
    success: TodoEvent,
    stream: true
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
  readonly version: () => number
}

export const makeTodoStore = (): TodoStore => {
  const todos = new Map<string, Todo>()
  let sequence = 0
  let version = 0
  const find = (id: string) => {
    const todo = todos.get(id)
    if (!todo) throw new TodoNotFound({ id })
    return todo
  }
  const normalize = (title: string) => title.trim()
  return {
    list: (filter) => [...todos.values()]
      .filter((todo) => filter === "all" || (filter === "active" ? !todo.completed : todo.completed))
      .sort((a, b) => a.order - b.order),
    add: (title) => {
      const normalized = normalize(title)
      if (normalized.length === 0) throw new InvalidTodoTitle({ title })
      const now = Date.now()
      const todo = new Todo({ id: `todo-${++sequence}`, title: normalized, completed: false, order: sequence, createdAt: now })
      todos.set(todo.id, todo)
      version++
      return todo
    },
    toggle: (id, completed) => {
      const todo = find(id)
      const updated = new Todo({ ...todo, completed })
      todos.set(id, updated)
      version++
      return updated
    },
    toggleAll: (completed) => {
      for (const todo of todos.values()) todos.set(todo.id, new Todo({ ...todo, completed }))
      version++
      return [...todos.values()].sort((a, b) => a.order - b.order)
    },
    update: (id, title) => {
      const normalized = normalize(title)
      if (normalized.length === 0) {
        todos.delete(id)
        throw new InvalidTodoTitle({ title })
      }
      const updated = new Todo({ ...find(id), title: normalized })
      todos.set(id, updated)
      version++
      return updated
    },
    remove: (id) => {
      const removed = todos.delete(id)
      if (removed) version++
      return removed
    },
    clearCompleted: () => {
      let removed = 0
      for (const [id, todo] of todos) if (todo.completed) { todos.delete(id); removed++ }
      if (removed > 0) version++
      return removed
    },
    version: () => version
  }
}

const makeTodoRepository = (store: TodoStore) => {
  return {
    list: (filter: TodoFilter) => Effect.sync(() => store.list(filter)),
    add: (title: string) => Effect.try({ try: () => store.add(title), catch: (cause) => cause as InvalidTodoTitle }),
    toggle: (id: string, completed: boolean) => Effect.try({ try: () => store.toggle(id, completed), catch: (cause) => cause as TodoNotFound }),
    toggleAll: (completed: boolean) => Effect.sync(() => store.toggleAll(completed)),
    update: (id: string, title: string) => Effect.try({ try: () => store.update(id, title), catch: (cause) => cause as InvalidTodoTitle | TodoNotFound }),
    remove: (id: string) => Effect.sync(() => store.remove(id)),
    clearCompleted: () => Effect.sync(() => store.clearCompleted())
  }
}

export const makeTodoHandlers = (store: TodoStore, changes?: PubSub.PubSub<Schema.Schema.Type<typeof TodoChangeKind>>) => {
  const repository = makeTodoRepository(store)
  const publish = (kind: Schema.Schema.Type<typeof TodoChangeKind>) => changes === undefined
    ? Effect.void
    : PubSub.publish(changes, kind).pipe(Effect.asVoid)
  return TodoRpcs.of({
    listTodos: ({ filter }) => Effect.gen(function*() {
      return yield* repository.list(filter)
    }),
    addTodo: ({ title }) => Effect.gen(function*() {
      return yield* repository.add(title).pipe(Effect.tap(() => publish("created")))
    }),
    toggleTodo: ({ id, completed }) => Effect.gen(function*() {
      return yield* repository.toggle(id, completed).pipe(Effect.tap(() => publish("updated")))
    }),
    toggleAllTodos: ({ completed }) => Effect.gen(function*() {
      return yield* repository.toggleAll(completed).pipe(Effect.tap(() => publish("reset")))
    }),
    updateTodo: ({ id, title }) => Effect.gen(function*() {
      return yield* repository.update(id, title).pipe(Effect.tap(() => publish("updated")))
    }),
    deleteTodo: ({ id }) => Effect.gen(function*() {
      return yield* repository.remove(id).pipe(Effect.tap((removed) => removed ? publish("deleted") : Effect.void))
    }),
    clearCompletedTodos: () => Effect.gen(function*() {
      return yield* repository.clearCompleted().pipe(Effect.tap((removed) => removed > 0 ? publish("reset") : Effect.void))
    }),
    countTodos: ({ filter }) => Effect.gen(function*() {
      return (yield* repository.list(filter)).length
    }),
    watchTodos: ({ filter }) => {
      const snapshot = (kind: Schema.Schema.Type<typeof TodoChangeKind>) => new TodoEvent({
        version: store.version(),
        kind,
        todos: store.list(filter)
      })
      if (changes === undefined) return Stream.make(snapshot("reset"))
      return Stream.make(snapshot("reset")).pipe(
        Stream.concat(Stream.fromPubSub(changes).pipe(Stream.map(snapshot)))
      )
    }
  })
}

export const makeTodoState = (todos: ReadonlyArray<Todo>, filter: TodoFilter, remaining: number): TodoState => ({ todos, filter, remaining })
