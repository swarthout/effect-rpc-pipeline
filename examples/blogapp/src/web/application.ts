import { Runtime } from "foldkit"
import { LoadFeed } from "./commands.js"
import { initialModel, type Model } from "./model.js"
import { type Message } from "./message.js"

export { Model, initialModel } from "./model.js"
export { Message } from "./message.js"
export { update } from "./update.js"
export { view } from "./views/view.js"

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel,
  commands: [LoadFeed({ search: "" })]
})
