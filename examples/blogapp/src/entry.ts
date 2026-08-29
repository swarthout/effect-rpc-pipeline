import { Runtime } from "foldkit"
import { Message, Model, init, update, view } from "./web/application.js"

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById("root"),
  devTools: { Message }
})

Runtime.hydrate(application, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
