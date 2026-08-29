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
  devTools: { Message }
})

Runtime.hydrate(application, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
