import { Runtime } from "foldkit"
import { type BlogClient } from "../client/blog-client.js"
import { RestoreSession } from "./commands.js"
import { Flags, modelFromFlags, type Model } from "./model.js"
import { type Message } from "./message.js"

export { Flags, Model, initialModel } from "./model.js"
export { Message } from "./message.js"
export { update } from "./update.js"
export { view } from "./views/view.js"

export const init: Runtime.ApplicationInit<Model, Message, Flags, BlogClient> = (flags) => ({
  model: modelFromFlags(flags),
  commands: [RestoreSession()]
})
