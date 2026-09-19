import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const output = resolve("dist/site");
rmSync(output, { recursive: true, force: true });
mkdirSync(output + "/playground", { recursive: true });
const result = await Bun.build({
  entrypoints: ["web/bootstrap.ts"],
  outdir: output + "/playground",
  target: "browser",
  format: "esm",
  minify: true,
  naming: {
    entry: "playground.js",
    asset: "[name]-[hash].[ext]",
    chunk: "[name]-[hash].js",
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
cpSync("web/index.html", output + "/index.html");
cpSync("web/site.css", output + "/site.css");
cpSync("web/playground.html", output + "/playground/index.html");
cpSync("web/_headers", output + "/_headers");
cpSync("vendor/licenses", output + "/licenses", { recursive: true });
for (const [source, name] of [
  ["LICENSE", "LICENSE"],
  ["NOTICE", "NOTICE"],
  ["assets/fonts/Inter-OFL.txt", "Inter-OFL.txt"],
  ["assets/fonts/JetBrainsMono-OFL.txt", "JetBrainsMono-OFL.txt"],
  ["assets/playground/OFL-Geist.txt", "Geist-OFL.txt"],
  ["assets/playground/LICENSE-icons", "LICENSE-icons"],
  ["node_modules/@gpuix/native/LICENSE", "LICENSE-GPUIX"],
  ["node_modules/react/LICENSE", "LICENSE-React"],
])
  cpSync(source!, output + "/licenses/" + name);
console.log(`Built ${output}`);
