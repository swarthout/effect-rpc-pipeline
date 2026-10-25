import * as Effect from "effect/Effect"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as Tracer from "effect/Tracer"

export type StatementKind = "read" | "write" | "other"

export interface StatementExecution {
  readonly sql: string
  readonly fingerprint: string
  readonly kind: StatementKind
}

export interface QueryReport {
  readonly statements: ReadonlyArray<StatementExecution>
  readonly rpcTags: ReadonlySet<string>
  readonly reads: number
  readonly writes: number
  readonly other: number
  readonly histogram: ReadonlyMap<string, number>
}

export interface Traced<A> {
  readonly value: A
  readonly report: QueryReport
}

export interface QueryTraceCollector {
  readonly tracer: Tracer.Tracer
  readonly report: () => QueryReport
  readonly reset: () => void
}

const normalizeSql = (sql: string): string => sql
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\bIN\s*\((?:\s*\?\s*,?)+\)/gi, "IN (?)")
  .replace(/\bVALUES\s*(?:\((?:\s*\?\s*,?)+\)\s*,?\s*)+/gi, "VALUES (?)")

const statementKind = (sql: string): StatementKind => {
  const operation = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase()
  if (operation === "SELECT" || operation === "PRAGMA" || operation === "WITH") return "read"
  if (operation === "INSERT" || operation === "UPDATE" || operation === "DELETE" || operation === "REPLACE") return "write"
  return "other"
}

const reportFrom = (spans: ReadonlyArray<Tracer.NativeSpan>): QueryReport => {
  const statements = spans.flatMap((span): ReadonlyArray<StatementExecution> => {
    const sql = span.attributes.get("db.query.text")
    if (typeof sql !== "string") return []
    return [{ sql, fingerprint: normalizeSql(sql), kind: statementKind(sql) }]
  })
  const histogram = new Map<string, number>()
  for (const statement of statements) {
    histogram.set(statement.fingerprint, (histogram.get(statement.fingerprint) ?? 0) + 1)
  }
  return {
    statements,
    rpcTags: new Set(spans.flatMap((span) => {
      if (span.name.startsWith("BlogRpc.") && span.name !== "BlogRpc.execute") {
        return [span.name.slice("BlogRpc.".length)]
      }
      const method = span.attributes.get("rpc.method")
      if (span.attributes.get("rpc.system.name") === "effect_rpc" && typeof method === "string") return [method]
      return []
    })),
    reads: statements.filter(({ kind }) => kind === "read").length,
    writes: statements.filter(({ kind }) => kind === "write").length,
    other: statements.filter(({ kind }) => kind === "other").length,
    histogram
  }
}

export const makeQueryTraceCollector = (): QueryTraceCollector => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  return {
    tracer,
    report: () => reportFrom(spans),
    reset: () => { spans.length = 0 }
  }
}

export const traceDatabaseWork = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Traced<A>, E, R> => {
  const collector = makeQueryTraceCollector()
  return Effect.map(Effect.withTracer(effect, collector.tracer), (value) => ({ value, report: collector.report() }))
}

const histogramObject = (report: QueryReport) => Object.fromEntries(
  [...report.histogram.entries()].sort(([left], [right]) => left.localeCompare(right))
)

export class QueryComplexityError extends Error {
  readonly _tag = "QueryComplexityError"
}

export const assertConstantDatabaseWork = (
  name: string,
  samples: ReadonlyArray<{ readonly size: number; readonly report: QueryReport }>,
  budget?: { readonly maxReads?: number; readonly maxWrites?: number; readonly ignoreWrites?: boolean }
): void => {
  if (samples.length < 2) throw new QueryComplexityError(`${name}: at least two fixture sizes are required`)
  const baseline = samples[0]!
  const failures: Array<string> = []
  for (const sample of samples) {
    if (sample.report.reads !== baseline.report.reads) {
      failures.push(`reads change from ${baseline.report.reads} at size ${baseline.size} to ${sample.report.reads} at size ${sample.size}`)
    }
    if (budget?.ignoreWrites !== true && sample.report.writes !== baseline.report.writes) {
      failures.push(`writes change from ${baseline.report.writes} at size ${baseline.size} to ${sample.report.writes} at size ${sample.size}`)
    }
    const fingerprints = new Set([...baseline.report.histogram.keys(), ...sample.report.histogram.keys()])
    for (const fingerprint of fingerprints) {
      const baselineCount = baseline.report.histogram.get(fingerprint) ?? 0
      const sampleCount = sample.report.histogram.get(fingerprint) ?? 0
      if (sampleCount !== baselineCount) {
        failures.push(`statement count changes from ${baselineCount} at size ${baseline.size} to ${sampleCount} at size ${sample.size}: ${fingerprint}`)
      }
    }
    if (budget?.maxReads !== undefined && sample.report.reads > budget.maxReads) {
      failures.push(`${sample.report.reads} reads exceed budget ${budget.maxReads} at size ${sample.size}`)
    }
    if (budget?.maxWrites !== undefined && sample.report.writes > budget.maxWrites) {
      failures.push(`${sample.report.writes} writes exceed budget ${budget.maxWrites} at size ${sample.size}`)
    }
  }
  if (failures.length > 0) {
    const details = samples.map(({ size, report }) =>
      `size ${size}: reads=${report.reads}, writes=${report.writes}\n${JSON.stringify(histogramObject(report), null, 2)}`
    ).join("\n\n")
    throw new QueryComplexityError(`${name}: database work is not constant\n- ${failures.join("\n- ")}\n\n${details}`)
  }
}

export const assertAllRpcsObserved = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  reports: ReadonlyArray<QueryReport>
): void => {
  const observed = new Set(reports.flatMap((report) => [...report.rpcTags]))
  const missing = [...group.requests.keys()].filter((tag) => !observed.has(tag)).sort()
  if (missing.length > 0) {
    throw new QueryComplexityError(`RPC complexity coverage is missing:\n- ${missing.join("\n- ")}`)
  }
}

export const trackMethodCalls = <A extends object>(api: A, observed: Set<string>): A => new Proxy(api, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver)
    if (typeof property !== "string" || typeof value !== "function") return value
    return (...args: ReadonlyArray<unknown>) => {
      observed.add(property)
      return Reflect.apply(value, target, args)
    }
  }
})

export const assertAllMethodsObserved = (api: object, observed: ReadonlySet<string>): void => {
  const methods = Object.entries(api).flatMap(([name, value]) => typeof value === "function" ? [name] : [])
  const missing = methods.filter((name) => !observed.has(name)).sort()
  if (missing.length > 0) {
    throw new QueryComplexityError(`client workflow complexity coverage is missing:\n- ${missing.join("\n- ")}`)
  }
}
