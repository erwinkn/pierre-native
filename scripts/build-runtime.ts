import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2] ?? "native";
if (target !== "native" && target !== "web")
  throw Error("Usage: bun scripts/build-runtime.ts [native|web]");
const output = resolve("dist/runtime");
const cargoTarget = resolve(process.env.CARGO_TARGET_DIR ?? ".cache/cargo");
mkdirSync(output, { recursive: true });
async function run(command: string[]) {
  const child = Bun.spawn(command, {
    env: { ...process.env, CARGO_TARGET_DIR: cargoTarget },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited) throw Error(`Failed: ${command.join(" ")}`);
}
if (target === "web") {
  await run([
    "cargo",
    "+" + (process.env.PIERRE_WASM_TOOLCHAIN ?? "nightly-2026-09-16"),
    "build",
    "--release",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "--no-default-features",
    "-p",
    "pierre-native-runtime",
  ]);
  await run([
    "wasm-bindgen",
    cargoTarget + "/wasm32-unknown-unknown/release/pierre_native_runtime.wasm",
    "--target",
    "web",
    "--out-dir",
    output + "/wasm",
    "--out-name",
    "pierre",
  ]);
} else {
  await run([
    "cargo",
    "build",
    "--release",
    "--locked",
    "-p",
    "pierre-native-runtime",
  ]);
  const library =
    process.platform === "darwin"
      ? "libpierre_native_runtime.dylib"
      : process.platform === "win32"
        ? "pierre_native_runtime.dll"
        : "libpierre_native_runtime.so";
  cpSync(cargoTarget + "/release/" + library, output + "/pierre.node");
}
