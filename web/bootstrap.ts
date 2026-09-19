import { configureNativeBindings } from "@gpuix/native/runtime";
import * as bindings from "../dist/runtime/wasm/pierre.js";
import wasmUrl from "../dist/runtime/wasm/pierre_bg.wasm" with { type: "file" };

await bindings.default({ module_or_path: wasmUrl });
const runtimeInfo = configureNativeBindings(
  bindings as unknown as Parameters<typeof configureNativeBindings>[0],
);
Object.assign(globalThis, { pierreRuntimeInfo: runtimeInfo });
await import("./playground");
