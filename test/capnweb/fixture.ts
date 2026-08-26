import { RpcTarget } from "capnweb"

export class ComparisonApi extends RpcTarget {
  greet(name: string): string { return `Hello ${name}` }
  ids(): string[] { return ["a", "b", "c"] }
}

export const expectedMappedResult = ["a", "b", "c"].map((id) => ({ id, greeting: `Hello ${id}` }))
