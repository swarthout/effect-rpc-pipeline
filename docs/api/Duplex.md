# Duplex

Low-level bidirectional session protocol used by the WebSocket helpers. Most applications do not need this module. Rpcs and individual protocol RPCs, Server and ClientSession, handlers, and value transforms support custom persistent transports.

Import from `effect-rpc-pipeline/Duplex`. See the [API overview](../api.md) and [contracts and limits](../guides/contracts.md).

These signatures are generated from the published declarations. Relative imports in the signatures refer to other package declarations. Update with `npm run docs:generate`.

```ts
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { CapabilityInstance, CapabilityRef } from "./Capability.js";
declare const DuplexError_base: Schema.Class<DuplexError, Schema.TaggedStruct<"DuplexError", {
    readonly reason: Schema.String;
    readonly sessionId: Schema.optional<Schema.String>;
    readonly capabilityId: Schema.optional<Schema.String>;
}>, Cause.YieldableError>;
export declare class DuplexError extends DuplexError_base {
}
export declare const CapabilityRefSchema: Schema.Schema<CapabilityRef>;
export type SessionEvent = Schema.Schema.Type<typeof SessionEventSchema>;
declare const SessionEventSchema: Schema.Union<readonly [Schema.Struct<{
    readonly _tag: Schema.Literal<"Ready">;
    readonly sessionId: Schema.String;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Invoke">;
    readonly callId: Schema.String;
    readonly definitionId: Schema.String;
    readonly capabilityId: Schema.String;
    readonly method: Schema.String;
    readonly payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Cancel">;
    readonly callId: Schema.String;
}>]>;
export declare const SessionRpc: Rpc.Rpc<"__effect_rpc_pipeline_session_v1", Schema.Struct<{
    sessionId: Schema.String;
}>, import("effect/rpc/RpcSchema").Stream<Schema.Union<readonly [Schema.Struct<{
    readonly _tag: Schema.Literal<"Ready">;
    readonly sessionId: Schema.String;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Invoke">;
    readonly callId: Schema.String;
    readonly definitionId: Schema.String;
    readonly capabilityId: Schema.String;
    readonly method: Schema.String;
    readonly payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Cancel">;
    readonly callId: Schema.String;
}>]>, typeof DuplexError>, Schema.Never, never, never>;
export declare const ReplyRpc: Rpc.Rpc<"__effect_rpc_pipeline_reply_v1", Schema.Struct<{
    sessionId: Schema.String;
    callId: Schema.String;
    exit: Schema.Struct<{
        readonly _tag: Schema.Union<readonly [Schema.Literal<"Success">, Schema.Literal<"Failure">]>;
        readonly value: Schema.optionalKey<Schema.Unknown>;
    }>;
}>, Schema.Void, typeof DuplexError, never, never>;
export declare const CallServerCapabilityRpc: Rpc.Rpc<"__effect_rpc_pipeline_capability_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
    method: Schema.String;
    payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly value: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Unknown, never, never>;
export declare const ReleaseCapabilityRpc: Rpc.Rpc<"__effect_rpc_pipeline_release_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
}>, Schema.Void, Schema.Never, never, never>;
export declare const Rpcs: RpcGroup.RpcGroup<Rpc.Rpc<"__effect_rpc_pipeline_capability_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
    method: Schema.String;
    payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly value: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Unknown, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_release_v1", Schema.Struct<{
    sessionId: Schema.String;
    definitionId: Schema.String;
    capabilityId: Schema.String;
}>, Schema.Void, Schema.Never, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_reply_v1", Schema.Struct<{
    sessionId: Schema.String;
    callId: Schema.String;
    exit: Schema.Struct<{
        readonly _tag: Schema.Union<readonly [Schema.Literal<"Success">, Schema.Literal<"Failure">]>;
        readonly value: Schema.optionalKey<Schema.Unknown>;
    }>;
}>, Schema.Void, typeof DuplexError, never, never> | Rpc.Rpc<"__effect_rpc_pipeline_session_v1", Schema.Struct<{
    sessionId: Schema.String;
}>, import("effect/rpc/RpcSchema").Stream<Schema.Union<readonly [Schema.Struct<{
    readonly _tag: Schema.Literal<"Ready">;
    readonly sessionId: Schema.String;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Invoke">;
    readonly callId: Schema.String;
    readonly definitionId: Schema.String;
    readonly capabilityId: Schema.String;
    readonly method: Schema.String;
    readonly payload: Schema.optionalKey<Schema.Unknown>;
}>, Schema.Struct<{
    readonly _tag: Schema.Literal<"Cancel">;
    readonly callId: Schema.String;
}>]>, typeof DuplexError>, Schema.Never, never, never>>;
export type ServerService = {
    readonly open: (sessionId: string, clientId: number) => Effect.Effect<Stream.Stream<SessionEvent, never>, DuplexError>;
    readonly reply: (clientId: number, sessionId: string, callId: string, exit: {
        readonly _tag: "Success" | "Failure";
        readonly value?: unknown;
    }) => Effect.Effect<void, DuplexError>;
    readonly invokeClient: (clientId: number, ref: CapabilityRef, method: string, payload: unknown) => Effect.Effect<unknown, unknown>;
    readonly registerServerCapability: (clientId: number, instance: CapabilityInstance) => CapabilityRef;
    readonly getServerCapability: (clientId: number, sessionId: string | undefined, definitionId: string, capabilityId: string) => CapabilityInstance | undefined;
    readonly callServerCapability: (clientId: number, sessionId: string, definitionId: string, capabilityId: string, method: string, payload: unknown, metadata?: Parameters<Rpc.Handler<string>["handler"]>[1]) => Effect.Effect<unknown, unknown>;
    readonly releaseServerCapability: (clientId: number, sessionId: string, definitionId: string, capabilityId: string) => void;
};
declare const Server_base: Context.ServiceClass<Server, "effect-rpc-pipeline/DuplexServer", ServerService>;
export declare class Server extends Server_base {
}
export declare const makeServer: Effect.Effect<ServerService, never, never>;
export declare const handlers: (server: ServerService) => {
    readonly __effect_rpc_pipeline_session_v1: ({ sessionId }: {
        readonly sessionId: string;
    }, { client }: {
        readonly client: Rpc.ServerClient;
        readonly requestId: import("effect/rpc/RpcMessage").RequestId;
        readonly headers: import("effect/http/Headers").Headers;
        readonly rpc: Rpc.Rpc<"__effect_rpc_pipeline_session_v1", Schema.Struct<{
            sessionId: Schema.String;
        }>, import("effect/rpc/RpcSchema").Stream<Schema.Union<readonly [Schema.Struct<{
            readonly _tag: Schema.Literal<"Ready">;
            readonly sessionId: Schema.String;
        }>, Schema.Struct<{
            readonly _tag: Schema.Literal<"Invoke">;
            readonly callId: Schema.String;
            readonly definitionId: Schema.String;
            readonly capabilityId: Schema.String;
            readonly method: Schema.String;
            readonly payload: Schema.optionalKey<Schema.Unknown>;
        }>, Schema.Struct<{
            readonly _tag: Schema.Literal<"Cancel">;
            readonly callId: Schema.String;
        }>]>, typeof DuplexError>, Schema.Never, never, never>;
    }) => Stream.Stream<{
        readonly _tag: "Ready";
        readonly sessionId: string;
    } | {
        readonly _tag: "Invoke";
        readonly callId: string;
        readonly definitionId: string;
        readonly capabilityId: string;
        readonly method: string;
        readonly payload?: unknown;
    } | {
        readonly _tag: "Cancel";
        readonly callId: string;
    }, DuplexError, never>;
    readonly __effect_rpc_pipeline_reply_v1: ({ sessionId, callId, exit }: {
        readonly sessionId: string;
        readonly callId: string;
        readonly exit: {
            readonly _tag: "Failure" | "Success";
            readonly value?: unknown;
        };
    }, { client }: {
        readonly client: Rpc.ServerClient;
        readonly requestId: import("effect/rpc/RpcMessage").RequestId;
        readonly headers: import("effect/http/Headers").Headers;
        readonly rpc: Rpc.Rpc<"__effect_rpc_pipeline_reply_v1", Schema.Struct<{
            sessionId: Schema.String;
            callId: Schema.String;
            exit: Schema.Struct<{
                readonly _tag: Schema.Union<readonly [Schema.Literal<"Success">, Schema.Literal<"Failure">]>;
                readonly value: Schema.optionalKey<Schema.Unknown>;
            }>;
        }>, Schema.Void, typeof DuplexError, never, never>;
    }) => Effect.Effect<void, DuplexError, never>;
    readonly __effect_rpc_pipeline_capability_v1: ({ sessionId, definitionId, capabilityId, method, payload }: {
        readonly sessionId: string;
        readonly definitionId: string;
        readonly capabilityId: string;
        readonly method: string;
        readonly payload?: unknown;
    }, metadata: {
        readonly client: Rpc.ServerClient;
        readonly requestId: import("effect/rpc/RpcMessage").RequestId;
        readonly headers: import("effect/http/Headers").Headers;
        readonly rpc: Rpc.Rpc<"__effect_rpc_pipeline_capability_v1", Schema.Struct<{
            sessionId: Schema.String;
            definitionId: Schema.String;
            capabilityId: Schema.String;
            method: Schema.String;
            payload: Schema.optionalKey<Schema.Unknown>;
        }>, Schema.Struct<{
            readonly value: Schema.optionalKey<Schema.Unknown>;
        }>, Schema.Unknown, never, never>;
    }) => Effect.Effect<{
        value?: never;
    } | {
        value: {} | null;
    }, unknown, never>;
    readonly __effect_rpc_pipeline_release_v1: ({ sessionId, definitionId, capabilityId }: {
        readonly sessionId: string;
        readonly definitionId: string;
        readonly capabilityId: string;
    }, { client }: {
        readonly client: Rpc.ServerClient;
        readonly requestId: import("effect/rpc/RpcMessage").RequestId;
        readonly headers: import("effect/http/Headers").Headers;
        readonly rpc: Rpc.Rpc<"__effect_rpc_pipeline_release_v1", Schema.Struct<{
            sessionId: Schema.String;
            definitionId: Schema.String;
            capabilityId: Schema.String;
        }>, Schema.Void, Schema.Never, never, never>;
    }) => Effect.Effect<void, never, never>;
};
export declare const resolveServerValue: (server: ServerService, clientId: number, value: unknown) => unknown;
export declare const encodeServerValue: (server: ServerService, clientId: number, value: unknown) => unknown;
export type ClientSession = {
    readonly sessionId: string;
    readonly ready: Effect.Effect<void, DuplexError>;
    readonly encodeLiteral: (value: unknown) => unknown;
    readonly decode: (value: unknown) => unknown;
};
export declare const makeClientSession: (client: RpcClient.RpcClient<RpcGroup.Rpcs<typeof Rpcs>, any>) => Effect.Effect<ClientSession, never, Scope.Scope>;
declare const Enabled_base: Context.Reference<boolean>;
export declare class Enabled extends Enabled_base {
}
export {};
```
