import { configureNativeBindings } from "@gpuix/native/runtime";
const bindings = require("../dist/runtime/pierre.node");

configureNativeBindings(bindings);
const { runApplication } = await import("@gpuix/react/application");
await runApplication(new URL("./worker.ts", import.meta.url), {
  title: "Pierre Native",
  width: 1440,
  height: 1000,
});
