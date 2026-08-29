import * as Schema from "effect/Schema"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", { reason: Schema.String }) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", { action: Schema.String }) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { resource: Schema.String, id: Schema.String }) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { resource: Schema.String, field: Schema.String }) {}
export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", { field: Schema.String, message: Schema.String }) {}
export class Suspended extends Schema.TaggedError<Suspended>()("Suspended", {}) {}
