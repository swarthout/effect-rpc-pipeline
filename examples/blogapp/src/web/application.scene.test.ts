import { Option } from "effect"
import { Command as SceneCommand, click, expect as sceneExpect, given, role, scene, text, type as typeField } from "foldkit/scene"
import { Command as StoryCommand, given as storyGiven, message, model, story } from "foldkit/story"
import { describe, expect, it } from "vitest"
import { Message, Model, initialModel, update, view } from "./application.js"
import { Register } from "./commands.js"

const modelFixture = Model.make(initialModel)

describe("Pipeline Press Foldkit application", () => {
  it("lets a public reader navigate to login and fill credentials", () => {
    scene(
      { update, view },
      given(modelFixture),
      sceneExpect(text("Ideas worth composing")).toExist(),
      click(role("button", { name: "Log in" })),
      sceneExpect(role("heading", { name: "Log in" })).toExist(),
      typeField(role("textbox", { name: "Username" }), "ada"),
      sceneExpect(role("textbox", { name: "Username" })).toHaveValue("ada")
    )
  })

  it("redirects an anonymous writer to login without issuing a command", () => {
    story(
      update,
      storyGiven(Model.make({ ...initialModel, page: "Editor", maybeSession: Option.none() })),
      message(Message.SubmittedPost()),
      StoryCommand.expectNone(),
      model((current) => expect(current.page).toBe("Login"))
    )
  })

  it("builds a typed registration command from the registration form", () => {
    scene(
      { update, view }, given(modelFixture),
      click(role("button", { name: "Log in" })),
      click(role("button", { name: "Create an account" })),
      typeField(role("textbox", { name: "Display name" }), "Ada Lovelace"),
      typeField(role("textbox", { name: "Username" }), "ada"),
      typeField(role("textbox", { name: "Password" }), "correct horse battery"),
      click(role("button", { name: "Register" })),
      SceneCommand.expectExact(Register({ username: "ada", displayName: "Ada Lovelace", password: "correct horse battery" })),
      SceneCommand.resolve(Register, Message.FailedRequest({ error: "Account already exists" })),
      sceneExpect(role("alert")).toHaveText("Account already exists")
    )
  })

  it("keeps editor fields as independent model state", () => {
    story(
      update,
      storyGiven(Model.make({ ...initialModel, page: "Editor" })),
      message(Message.ChangedTitle({ value: "A typed pipeline" })),
      message(Message.ChangedBody({ value: "A sufficiently detailed article body." })),
      model((current) => {
        expect(current.title).toBe("A typed pipeline")
        expect(current.body).toContain("sufficiently detailed")
      })
    )
  })
})
