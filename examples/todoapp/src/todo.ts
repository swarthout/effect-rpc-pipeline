import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"

export const TodoFilter = Schema.Union([Schema.Literal("all"), Schema.Literal("active"), Schema.Literal("completed")])
export type TodoFilter = Schema.Schema.Type<typeof TodoFilter>

export class Todo extends Schema.Class<Todo>("Todo")({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  order: Schema.Number,
  createdAt: Schema.Number
}) {}

export class InvalidTodoTitle extends Schema.TaggedError<InvalidTodoTitle>()("InvalidTodoTitle", { title: Schema.String }) {}
export class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", { id: Schema.String }) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

export interface User {
  readonly id: string
  readonly name: string
  readonly scopes: ReadonlySet<string>
}

export class CurrentUser extends Context.Service<CurrentUser, User>()("todo/CurrentUser") {}
export class AccessTokenVerifier extends Context.Service<AccessTokenVerifier, {
  readonly verify: (token: Redacted.Redacted<string>) => Effect.Effect<User, Unauthorized>
}>()("todo/AccessTokenVerifier") {}
export class Authenticated extends RpcMiddleware.Service<Authenticated, {
  readonly provides: CurrentUser
  readonly requires: AccessTokenVerifier
}>()("todo/Authenticated", { error: Unauthorized, requiredForClient: true }) {}

export const TodoChangeKind = Schema.Union([
  Schema.Literal("created"), Schema.Literal("updated"), Schema.Literal("deleted"), Schema.Literal("reset")
])

export class TodoEvent extends Schema.Class<TodoEvent>("TodoEvent")({
  version: Schema.Number,
  kind: TodoChangeKind,
  todos: Schema.Array(Todo)
}) {}

export const TodoRpcs = RpcGroup.make(
  Rpc.make("listTodos", { payload: { filter: TodoFilter }, success: Schema.Array(Todo) }),
  Rpc.make("addTodo", { payload: { title: Schema.String }, success: Todo, error: Schema.Union([InvalidTodoTitle, Forbidden]) }),
  Rpc.make("toggleTodo", { payload: { id: Schema.String, completed: Schema.Boolean }, success: Todo, error: Schema.Union([TodoNotFound, Forbidden]) }),
  Rpc.make("toggleAllTodos", { payload: { completed: Schema.Boolean }, success: Schema.Array(Todo), error: Forbidden }),
  Rpc.make("updateTodo", { payload: { id: Schema.String, title: Schema.String }, success: Todo, error: Schema.Union([TodoNotFound, InvalidTodoTitle, Forbidden]) }),
  Rpc.make("deleteTodo", { payload: { id: Schema.String }, success: Schema.Boolean, error: Forbidden }),
  Rpc.make("clearCompletedTodos", { success: Schema.Number, error: Forbidden }),
  Rpc.make("countTodos", { payload: { filter: TodoFilter }, success: Schema.Number }),
  Rpc.make("watchTodos", { payload: { filter: TodoFilter }, success: TodoEvent, stream: true })
).middleware(Authenticated)

export const HealthRpc = Rpc.make("health", { success: Schema.String })
export const AppRpcs = RpcGroup.make(HealthRpc).merge(TodoRpcs)

export type TodoState = {
  readonly todos: ReadonlyArray<Todo>
  readonly filter: TodoFilter
  readonly remaining: number
}

export type TodoStore = {
  readonly list: (ownerId: string, filter: TodoFilter) => ReadonlyArray<Todo>
  readonly add: (ownerId: string, title: string) => Todo
  readonly toggle: (ownerId: string, id: string, completed: boolean) => Todo
  readonly toggleAll: (ownerId: string, completed: boolean) => ReadonlyArray<Todo>
  readonly update: (ownerId: string, id: string, title: string) => Todo
  readonly remove: (ownerId: string, id: string) => boolean
  readonly clearCompleted: (ownerId: string) => number
  readonly version: (ownerId: string) => number
}

export const makeTodoStore = (): TodoStore => {
  const stores = new Map<string, Map<string, Todo>>()
  const versions = new Map<string, number>()
  let sequence = 0
  const todosFor = (ownerId: string) => {
    const existing = stores.get(ownerId)
    if (existing !== undefined) return existing
    const created = new Map<string, Todo>()
    stores.set(ownerId, created)
    return created
  }
  const changed = (ownerId: string) => versions.set(ownerId, (versions.get(ownerId) ?? 0) + 1)
  const find = (ownerId: string, id: string) => {
    const todo = todosFor(ownerId).get(id)
    if (todo === undefined) throw new TodoNotFound({ id })
    return todo
  }
  return {
    list: (ownerId, filter) => [...todosFor(ownerId).values()]
      .filter((todo) => filter === "all" || (filter === "active" ? !todo.completed : todo.completed))
      .sort((a, b) => a.order - b.order),
    add: (ownerId, title) => {
      const normalized = title.trim()
      if (normalized.length === 0) throw new InvalidTodoTitle({ title })
      const todo = new Todo({ id: `todo-${++sequence}`, title: normalized, completed: false, order: sequence, createdAt: Date.now() })
      todosFor(ownerId).set(todo.id, todo)
      changed(ownerId)
      return todo
    },
    toggle: (ownerId, id, completed) => {
      const updated = new Todo({ ...find(ownerId, id), completed })
      todosFor(ownerId).set(id, updated)
      changed(ownerId)
      return updated
    },
    toggleAll: (ownerId, completed) => {
      const todos = todosFor(ownerId)
      for (const todo of todos.values()) todos.set(todo.id, new Todo({ ...todo, completed }))
      changed(ownerId)
      return [...todos.values()].sort((a, b) => a.order - b.order)
    },
    update: (ownerId, id, title) => {
      const normalized = title.trim()
      if (normalized.length === 0) throw new InvalidTodoTitle({ title })
      const updated = new Todo({ ...find(ownerId, id), title: normalized })
      todosFor(ownerId).set(id, updated)
      changed(ownerId)
      return updated
    },
    remove: (ownerId, id) => {
      const removed = todosFor(ownerId).delete(id)
      if (removed) changed(ownerId)
      return removed
    },
    clearCompleted: (ownerId) => {
      const todos = todosFor(ownerId)
      let removed = 0
      for (const [id, todo] of todos) if (todo.completed) { todos.delete(id); removed++ }
      if (removed > 0) changed(ownerId)
      return removed
    },
    version: (ownerId) => versions.get(ownerId) ?? 0
  }
}

const repository = (store: TodoStore, ownerId: string) => ({
  list: (filter: TodoFilter) => Effect.sync(() => store.list(ownerId, filter)),
  add: (title: string) => Effect.try({ try: () => store.add(ownerId, title), catch: (cause) => cause as InvalidTodoTitle }),
  toggle: (id: string, completed: boolean) => Effect.try({ try: () => store.toggle(ownerId, id, completed), catch: (cause) => cause as TodoNotFound }),
  toggleAll: (completed: boolean) => Effect.sync(() => store.toggleAll(ownerId, completed)),
  update: (id: string, title: string) => Effect.try({ try: () => store.update(ownerId, id, title), catch: (cause) => cause as InvalidTodoTitle | TodoNotFound }),
  remove: (id: string) => Effect.sync(() => store.remove(ownerId, id)),
  clearCompleted: () => Effect.sync(() => store.clearCompleted(ownerId))
})

export interface TodoChange {
  readonly ownerId: string
  readonly kind: Schema.Schema.Type<typeof TodoChangeKind>
}

export const makeTodoHandlers = (store: TodoStore, changes?: PubSub.PubSub<TodoChange>) => {
  const publish = (ownerId: string, kind: TodoChange["kind"]) => changes === undefined
    ? Effect.void
    : PubSub.publish(changes, { ownerId, kind }).pipe(Effect.asVoid)
  const withWrite = <A, E>(f: (user: User) => Effect.Effect<A, E>): Effect.Effect<A, E | Forbidden, CurrentUser> =>
    Effect.flatMap(CurrentUser, (user): Effect.Effect<A, E | Forbidden> =>
      user.scopes.has("todos:write") ? f(user) : Effect.fail(new Forbidden()))
  return AppRpcs.of({
    health: () => Effect.succeed("ok"),
    listTodos: ({ filter }) => Effect.flatMap(CurrentUser, (user) => repository(store, user.id).list(filter)),
    addTodo: ({ title }) => withWrite((user) => repository(store, user.id).add(title).pipe(Effect.tap(() => publish(user.id, "created")))),
    toggleTodo: ({ id, completed }) => withWrite((user) => repository(store, user.id).toggle(id, completed).pipe(Effect.tap(() => publish(user.id, "updated")))),
    toggleAllTodos: ({ completed }) => withWrite((user) => repository(store, user.id).toggleAll(completed).pipe(Effect.tap(() => publish(user.id, "reset")))),
    updateTodo: ({ id, title }) => withWrite((user) => repository(store, user.id).update(id, title).pipe(Effect.tap(() => publish(user.id, "updated")))),
    deleteTodo: ({ id }) => withWrite((user) => repository(store, user.id).remove(id).pipe(Effect.tap((removed) => removed ? publish(user.id, "deleted") : Effect.void))),
    clearCompletedTodos: () => withWrite((user) => repository(store, user.id).clearCompleted().pipe(Effect.tap((removed) => removed > 0 ? publish(user.id, "reset") : Effect.void))),
    countTodos: ({ filter }) => Effect.flatMap(CurrentUser, (user) => Effect.map(repository(store, user.id).list(filter), (todos) => todos.length)),
    watchTodos: ({ filter }) => Stream.unwrap(Effect.map(CurrentUser, (user) => {
      const snapshot = (kind: TodoChange["kind"]) => new TodoEvent({ version: store.version(user.id), kind, todos: store.list(user.id, filter) })
      if (changes === undefined) return Stream.make(snapshot("reset"))
      return Stream.make(snapshot("reset")).pipe(Stream.concat(
        Stream.fromPubSub(changes).pipe(
          Stream.filter((change) => change.ownerId === user.id),
          Stream.map((change) => snapshot(change.kind))
        )
      ))
    }))
  })
}

export const makeTodoState = (todos: ReadonlyArray<Todo>, filter: TodoFilter, remaining: number): TodoState => ({ todos, filter, remaining })
