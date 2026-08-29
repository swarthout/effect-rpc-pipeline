import { Button, Input, Textarea } from "@foldkit/ui"
import { type HtmlBuilder } from "foldkit/html"
import { type Message } from "../message.js"

export const button = (label: string, onClick: Message, h: HtmlBuilder<Message>, kind = "primary") => Button.view({
  onClick, toView: (attributes) => h.button([...attributes.button, h.Class(`button ${kind}`)], [label])
}, h)

export const input = (id: string, label: string, value: string, onInput: (value: string) => Message, h: HtmlBuilder<Message>, type: "text" | "password" = "text") => Input.view({
  id, value, type, onInput,
  toView: (attributes) => h.label([...attributes.label, h.Class("field")], [h.span([], [label]), h.input([...attributes.input, h.Class("input")])])
}, h)

export const textarea = (id: string, label: string, value: string, onInput: (value: string) => Message, h: HtmlBuilder<Message>) => Textarea.view({
  id, value, onInput,
  toView: (attributes) => h.label([...attributes.label, h.Class("field")], [h.span([], [label]), h.textarea([...attributes.textarea, h.Class("textarea")])])
}, h)
