import { describe, expect, it } from "vitest"
import { ComparisonApi, expectedMappedResult } from "./fixture.js"

describe("Cap’n Web behavioral reference", () => {
  it("keeps the shared mapping behavior explicit", () => {
    const api = new ComparisonApi()
    expect(api.ids().map((id) => ({ id, greeting: api.greet(id) }))).toEqual(expectedMappedResult)
  })
})
