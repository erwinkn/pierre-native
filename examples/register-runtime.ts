import { configureNativeBindings } from "@gpuix/native/runtime";
const bindings = require("../dist/runtime/pierre.node");

// Bun --preload loads this before the test's GPUiX React imports.
configureNativeBindings(bindings);
