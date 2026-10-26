import { Effect, Match, Option, Schema } from "effect"
import { Command, Runtime, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import * as Render from "foldkit/render"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { load, pushUrl, UrlRequest } from "foldkit/navigation"
import { modifyFields } from "foldkit/struct"
import { Url, toString as urlToString } from "foldkit/url"
import { AppRoute, urlToAppRoute } from "./route"
export { view } from "./view"

export const Theme = Schema.Literals(["System", "Light", "Dark"])
export const SelectionMode = Schema.Literals(["Query", "Mutation"])
export const Demo = defineTaggedUnion({
  Idle: {},
  User: {},
  Parallel: {},
  Complete: {},
})
export const Model = Schema.Struct({
  route: AppRoute,
  theme: Theme,
  menu: Schema.Literals(["Closed", "Open"]),
  query: Schema.String,
  maybeCopied: Schema.Option(Schema.String),
  demo: Demo,
  demoPlayback: Schema.Literals(["Paused", "Playing"]),
  demoRevision: Schema.Number,
  notice: Schema.String,
  selectionMode: SelectionMode,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},
  CompletedRestoreReadingPosition: {},
  CompletedLoad: {},
  ClickedMenu: {},
  ChangedSearch: { query: Schema.String },
  ClickedTheme: {},
  CompletedSaveTheme: {},
  CompletedReadTheme: { theme: Theme },
  ClickedCopy: { text: Schema.String },
  CompletedCopy: { text: Schema.String },
  FailedCopy: {},
  ClickedDemoRun: {},
  ClickedDemoStep: {},
  ClickedDemoReset: {},
  CompletedWaitForStep: { revision: Schema.Number },
  ClickedSelectionMode: { mode: SelectionMode },
})
export type Message = typeof Message.Type

const Navigate = Command.define("Navigate", {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
})
const RestoreReadingPosition = Command.define("RestoreReadingPosition", {
  args: { maybeHash: Schema.Option(Schema.String), url: Schema.String },
  messages: [Message.CompletedRestoreReadingPosition],
  execute: ({ maybeHash, url }) =>
    Effect.gen(function* () {
      yield* Render.afterPaint
      if (window.location.href !== url) {
        return
      }
      if (Option.isSome(maybeHash)) {
        const hash = decodeFragment(maybeHash.value)
        const target = `#${CSS.escape(hash)}`
        yield* Dom.scrollIntoViewAfterPaint(target, { block: "start" })
        yield* Dom.focus(target, { preventScroll: true, makeFocusable: true })
      } else {
        yield* Dom.focus("#main-content", { preventScroll: true, makeFocusable: true })
        yield* Effect.sync(() => window.scrollTo({ top: 0, behavior: "instant" }))
      }
    }).pipe(Effect.ignore, Effect.as(Message.CompletedRestoreReadingPosition())),
})
const decodeFragment = (hash: string): string => {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}
const Load = Command.define("Load", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoad],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoad())),
})
const ReadTheme = Command.define("ReadTheme", {
  messages: [Message.CompletedReadTheme],
  execute: Effect.sync(() => {
    try {
      return Schema.decodeUnknownSync(Theme)(localStorage.getItem("pipeline-theme") ?? "System")
    } catch {
      return "System"
    }
  }).pipe(Effect.map((theme) => Message.CompletedReadTheme({ theme }))),
})
const SaveTheme = Command.define("SaveTheme", {
  args: { theme: Theme },
  messages: [Message.CompletedSaveTheme],
  execute: ({ theme }) =>
    Effect.sync(() => {
      try {
        localStorage.setItem("pipeline-theme", theme)
      } catch {
        return
      }
    }).pipe(Effect.as(Message.CompletedSaveTheme())),
})
const Copy = Command.define("Copy", {
  args: { text: Schema.String },
  messages: [Message.CompletedCopy, Message.FailedCopy],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.as(Message.CompletedCopy({ text })),
      Effect.catch(() => Effect.succeed(Message.FailedCopy())),
    ),
})
const WaitForStep = Command.define("WaitForStep", {
  args: { revision: Schema.Number },
  messages: [Message.CompletedWaitForStep],
  execute: ({ revision }) =>
    Effect.sleep("900 millis").pipe(Effect.as(Message.CompletedWaitForStep({ revision }))),
})

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => ({
  model: {
    route: urlToAppRoute(url),
    theme: "System",
    menu: "Closed",
    query: "",
    maybeCopied: Option.none(),
    demo: Demo.Idle(),
    demoPlayback: "Paused",
    demoRevision: 0,
    notice: "",
    selectionMode: "Query",
  },
  commands: [ReadTheme()],
})

const nextDemo = (demo: typeof Demo.Type) =>
  Demo.match(demo, {
    Idle: () => Demo.User(),
    User: () => Demo.Parallel(),
    Parallel: () => Demo.Complete(),
    Complete: () => Demo.Idle(),
  })
const advanceDemo = (model: Model): Update.Return<Model, Message> => {
  const demo = nextDemo(model.demo)
  const isFinished = demo._tag === "Complete"
  return {
    model: modifyFields(model, {
      demo: () => demo,
      demoPlayback: () => (isFinished ? "Paused" : model.demoPlayback),
    }),
    commands:
      !isFinished && model.demoPlayback === "Playing"
        ? [WaitForStep({ revision: model.demoRevision })]
        : [],
  }
}

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedLink: ({ request }) =>
      Match.value(request).pipe(
        Match.withReturnType<Update.Return<Model, Message>>(),
        Match.tagsExhaustive({
          Internal: ({ url }) => ({ model, commands: [Navigate({ url: urlToString(url) })] }),
          External: ({ href }) => ({ model, commands: [Load({ href })] }),
        }),
      ),
    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const isPageChanged =
        model.route._tag !== route._tag ||
        (model.route._tag === "Page" && route._tag === "Page" && model.route.slug !== route.slug) ||
        (model.route._tag === "NotFound" &&
          route._tag === "NotFound" &&
          model.route.path !== route.path)
      return {
        model: modifyFields(model, {
          route: () => route,
          menu: () => "Closed",
          query: () => "",
          maybeCopied: () => Option.none(),
          demoRevision: (revision) => revision + 1,
          demoPlayback: () => "Paused",
        }),
        commands:
          isPageChanged || Option.isSome(url.hash)
            ? [RestoreReadingPosition({ maybeHash: url.hash, url: urlToString(url) })]
            : [],
      }
    },
    CompletedNavigate: () => ({ model }),
    CompletedRestoreReadingPosition: () => ({ model }),
    CompletedLoad: () => ({ model }),
    ClickedMenu: () => ({
      model: modifyFields(model, { menu: (menu) => (menu === "Closed" ? "Open" : "Closed") }),
    }),
    ChangedSearch: ({ query }) => ({ model: modifyFields(model, { query: () => query }) }),
    ClickedTheme: () => {
      const theme = { System: "Light", Light: "Dark", Dark: "System" }[model.theme]
      const nextTheme = Schema.decodeUnknownSync(Theme)(theme)
      return {
        model: modifyFields(model, { theme: () => nextTheme }),
        commands: [SaveTheme({ theme: nextTheme })],
      }
    },
    CompletedSaveTheme: () => ({ model }),
    CompletedReadTheme: ({ theme }) => ({ model: modifyFields(model, { theme: () => theme }) }),
    ClickedCopy: ({ text }) => ({ model, commands: [Copy({ text })] }),
    CompletedCopy: ({ text }) => ({
      model: modifyFields(model, {
        maybeCopied: () => Option.some(text),
        notice: () => "Copied to clipboard",
      }),
    }),
    FailedCopy: () => ({
      model: modifyFields(model, {
        notice: () => "Clipboard unavailable. Select and copy the code manually.",
      }),
    }),
    ClickedDemoRun: () => {
      const demoRevision = model.demoRevision + 1
      return {
        model: modifyFields(model, {
          demo: () => Demo.User(),
          demoPlayback: () => "Playing",
          demoRevision: () => demoRevision,
        }),
        commands: [WaitForStep({ revision: demoRevision })],
      }
    },
    ClickedDemoStep: () => advanceDemo(model),
    ClickedDemoReset: () => ({
      model: modifyFields(model, {
        demo: () => Demo.Idle(),
        demoPlayback: () => "Paused",
        demoRevision: (revision) => revision + 1,
      }),
    }),
    CompletedWaitForStep: ({ revision }) =>
      revision === model.demoRevision && model.demoPlayback === "Playing"
        ? advanceDemo(model)
        : { model },
    ClickedSelectionMode: ({ mode }) => ({
      model: modifyFields(model, { selectionMode: () => mode }),
    }),
  })
