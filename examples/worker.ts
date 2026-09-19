import { configureNativeBindings } from "@gpuix/native/runtime";
configureNativeBindings(require("../dist/runtime/pierre.node"));
const { attachApplication } = await import("@gpuix/react/application");
attachApplication();
await import("./desktop");
