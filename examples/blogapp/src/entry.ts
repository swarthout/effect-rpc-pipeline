import { Runtime } from "foldkit"
import { layerHttpClient } from "./client/blog-client.js"
import { Flags, Message, Model, init, update, view } from "./web/application.js"

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  resources: layerHttpClient(),
  container: document.getElementById("root"),
  devTools: import.meta.env.DEV ? { Message } : false,
  // Slow-phase diagnostics include full Models, including credential fields.
  slow: false
})

Runtime.hydrate(application, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
