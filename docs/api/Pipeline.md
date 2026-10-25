# Pipeline

Compose lazy remote calls with all, map, andThen, zipRight, and field. Data describes the plain data returned by finite pipelines. Expr, node, request and transport types describe the low-level wire protocol.

Import from `effect-rpc-pipeline/Pipeline`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

```ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import type * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type * as Headers from "effect/http/Headers";
import { CapabilityGroupTypeId } from "./Capability.js";
export declare const PipelineRefTypeId: unique symbol;
declare const OperationTypeId: unique symbol;
declare const PipelineProtocolError_base: Schema.Class<PipelineProtocolError, Schema.TaggedStruct<"PipelineProtocolError", {
    readonly message: Schema.String;
    readonly code: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class PipelineProtocolError extends PipelineProtocolError_base {
    constructor(message: string, code?: string);
}
declare const PipelineExecutionError_base: Schema.Class<PipelineExecutionError, Schema.TaggedStruct<"PipelineExecutionError", {
    readonly message: Schema.String;
    readonly code: Schema.String;
    readonly retryable: Schema.Boolean;
}>, import("effect/Cause").YieldableError>;
/** A safe, transportable failure raised by server execution infrastructure. */
export declare class PipelineExecutionError extends PipelineExecutionError_base {
}
export type Expr = {
    readonly _tag: "literal";
    readonly value?: unknown;
} | {
    readonly _tag: "ref";
    readonly id: string;
    readonly path: ReadonlyArray<string | number>;
} | {
    readonly _tag: "item";
    readonly scope: string;
    readonly path: ReadonlyArray<string | number>;
} | {
    readonly _tag: "array";
    readonly values: ReadonlyArray<Expr>;
} | {
    readonly _tag: "object";
    readonly entries: ReadonlyArray<readonly [string, Expr]>;
} | {
    readonly _tag: "none";
} | {
    readonly _tag: "some";
    readonly value: Expr;
};
export type CallNode = {
    readonly _tag: "call";
    readonly id: string;
    readonly scope?: string;
    readonly target?: Expr;
    readonly method: string;
    readonly payload: Expr;
    readonly dependencies: ReadonlyArray<string>;
};
export type MapNode = {
    readonly _tag: "map";
    readonly id: string;
    readonly scope?: string;
    readonly source: Expr;
    readonly template: Expr;
    readonly dependencies: ReadonlyArray<string>;
};
export type PipelineNode = CallNode | MapNode;
export type PipelineRequest = {
    readonly version: 1;
    readonly definitionId: string;
    readonly nodes: ReadonlyArray<PipelineNode>;
    readonly selection: Expr;
    readonly discards: ReadonlyArray<string>;
};
export type PipelineTransport = (request: PipelineRequest, options?: {
    readonly headers: Headers.Headers;
}) => Effect.Effect<{
    readonly _tag: "Success";
    readonly value: unknown;
} | {
    readonly _tag: "Failure";
    readonly error: unknown;
}, unknown, never>;
type Runtime = {
    scope: string | undefined;
    readonly definitionId: string;
    readonly execute: (request: PipelineRequest) => Effect.Effect<unknown, unknown, never>;
    readonly encodeLiteral?: (value: unknown) => unknown;
    nextId(): string;
};
type Graph = {
    readonly runtime: Runtime;
    readonly nodes: ReadonlyArray<PipelineNode>;
    readonly selection: Expr;
    readonly discards: ReadonlyArray<string>;
};
type InternalOperation = Effect.Effect<any, any, any> & {
    readonly [OperationTypeId]: true;
    readonly [PipelineRefTypeId]: true;
    readonly graph: Graph;
};
type CapabilityClient<A, E, R> = A extends {
    readonly [CapabilityGroupTypeId]: infer Group extends RpcGroup.RpcGroup<any>;
} ? ClientApi<RpcGroup.Rpcs<Group>, E, R> : unknown;
type RemoteFields<A, E, R> = A extends Option.Option<any> | ReadonlyArray<any> ? unknown : A extends object ? {
    readonly [K in keyof A as A[K] extends (...args: any[]) => any ? never : K]: Remote<A[K], E, R>;
} : unknown;
type MiddlewareClientError<R extends Rpc.Any> = R extends Rpc.Rpc<any, any, any, any, infer Middleware, any> ? Middleware extends RpcMiddleware.AnyService ? Middleware["~ClientError"] : never : never;
/** A remote value that composes without I/O and is also a normal Effect when yielded. */
export type Remote<A, E = unknown, R = never> = Effect.Effect<A, E, R> & {
    readonly [PipelineRefTypeId]: true;
    readonly readonlyType?: A;
} & CapabilityClient<A, E, R> & RemoteFields<A, E, R>;
export type PipelineOperation<A, E = unknown, R = never> = Remote<A, E, R>;
/** Finite pipelines return data fields; class methods and prototypes do not cross the wire. */
export type Data<A> = A extends {
    readonly [CapabilityGroupTypeId]: unknown;
} ? A : A extends Option.Option<infer I> ? Option.Option<Data<I>> : A extends ReadonlyArray<unknown> ? {
    readonly [K in keyof A]: Data<A[K]>;
} : A extends Date | ReadonlyMap<any, any> | ReadonlySet<any> ? never : A extends object ? {
    readonly [K in keyof A as A[K] extends (...args: any[]) => any ? never : K]: Data<A[K]>;
} : A;
type PipelineMethod<R extends Rpc.Any, E, Env> = <const Input extends PipelineInput<Rpc.PayloadConstructor<R>> = Rpc.PayloadConstructor<R>>(...args: undefined extends Rpc.PayloadConstructor<R> ? readonly [input?: Input] : readonly [input: Input]) => Remote<Data<Rpc.Success<R>>, Rpc.Error<R> | MiddlewareClientError<R> | E | ErrorsIn<Input>, Rpc.ServicesClient<R> | Env | ServicesIn<Input>>;
/** Exact RPC tags become client keys. Dots have no special meaning. */
type ClientMethod<R extends Rpc.Any, E, Env> = Rpc.Success<R> extends Stream.Stream<any, any, any> ? RpcClient.RpcClient<R, E>[R["_tag"]] : PipelineMethod<R, E, Env>;
export type ClientApi<Rpcs extends Rpc.Any, E = RpcClientError | PipelineProtocolError | PipelineExecutionError, Env = never> = {
    readonly [R in Rpcs as R["_tag"]]: ClientMethod<R, E, Env>;
};
export type PipelineInput<A> = A | Remote<A, any, any> | (A extends ReadonlyArray<infer I> ? ReadonlyArray<PipelineInput<I>> : A extends Option.Option<infer I> ? Option.Option<PipelineInput<I>> : A extends object ? {
    readonly [K in keyof A]: PipelineInput<A[K]>;
} : never);
export type SelectionInput<A> = A extends {
    readonly [PipelineRefTypeId]: true;
} ? A : A extends Effect.Effect<any, any, any> ? never : A extends Option.Option<infer I> ? Option.Option<SelectionInput<I>> : A extends ReadonlyArray<infer I> ? ReadonlyArray<SelectionInput<I>> : A extends object ? {
    readonly [K in keyof A]: SelectionInput<A[K]>;
} : A;
export type Resolved<A> = A extends Effect.Effect<infer Success, any, any> ? Success : A extends Option.Option<infer I> ? Option.Option<Resolved<I>> : A extends ReadonlyArray<infer I> ? ReadonlyArray<Resolved<I>> : A extends object ? {
    readonly [K in keyof A]: Resolved<A[K]>;
} : A;
type ErrorsIn<A> = A extends Effect.Effect<any, infer E, any> ? E : A extends Option.Option<infer I> ? ErrorsIn<I> : A extends ReadonlyArray<infer I> ? ErrorsIn<I> : A extends object ? {
    readonly [K in keyof A]: ErrorsIn<A[K]>;
}[keyof A] : never;
type ServicesIn<A> = A extends Effect.Effect<any, any, infer R> ? R : A extends Option.Option<infer I> ? ServicesIn<I> : A extends ReadonlyArray<infer I> ? ServicesIn<I> : A extends object ? {
    readonly [K in keyof A]: ServicesIn<A[K]>;
}[keyof A] : never;
declare const isOperation: (u: unknown) => u is InternalOperation;
export declare const makeClient: <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, definitionId: string, execute: Runtime["execute"], options?: {
    readonly streamClient?: Record<string, (...args: ReadonlyArray<any>) => unknown>;
    readonly encodeLiteral?: Runtime["encodeLiteral"];
}) => ClientApi<Rpcs>;
/** Combines structured remote values into one request. */
export declare const all: <A>(value: A & SelectionInput<A>) => Remote<Resolved<A>, ErrorsIn<A>, ServicesIn<A>>;
export declare function map<A, B, E, R>(source: Remote<ReadonlyArray<A>, E, R>, mapper: (item: Remote<A, never, never>) => B & SelectionInput<B>): Remote<ReadonlyArray<Resolved<B>>, E | ErrorsIn<B>, R | ServicesIn<B>>;
export declare function map<A, B, E, R>(source: Remote<Option.Option<A>, E, R>, mapper: (item: Remote<A, never, never>) => B & SelectionInput<B>): Remote<Option.Option<Resolved<B>>, E | ErrorsIn<B>, R | ServicesIn<B>>;
/**
 * Builds a new pipeline phase from the remote result of `self`.
 *
 * The callback runs while constructing the request and receives a symbolic remote
 * value. Every operation introduced by the callback starts after `self` has
 * completed, while independent operations within the new phase may run in
 * parallel. The callback may return any encodable structure of remote values.
 */
export declare function andThen<A, E, R, B>(self: Remote<A, E, R>, next: (value: Remote<A, never, never>) => B & SelectionInput<B>): Remote<Resolved<B>, E | ErrorsIn<B>, R | ServicesIn<B>>;
export declare function andThen<A, B>(next: (value: Remote<A, never, never>) => B & SelectionInput<B>): <E, R>(self: Remote<A, E, R>) => Remote<Resolved<B>, E | ErrorsIn<B>, R | ServicesIn<B>>;
/** Orders `right` after `left` while retaining only the right-hand result. */
export declare const zipRight: <A, B, E, E2, R, R2>(left: Remote<A, E, R>, right: Remote<B, E2, R2>) => Remote<B, E | E2, R | R2>;
export declare const isPipelineRef: typeof isOperation;
export declare const isOption: (input: unknown) => input is Option.Option<unknown>;
/** Projects a field explicitly, including names reserved by Effect or JavaScript. */
export declare const field: <A, E, R, K extends keyof A>(self: Remote<A, E, R>, key: K) => Remote<A[K], E, R>;
export {};
```
