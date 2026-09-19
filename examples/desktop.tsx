import { render } from "@gpuix/react";
import { configureClipboard } from "../src/platform";
import { PlaygroundApp } from "../src/experiments/diffs/playground/app";
import { PlaygroundModel } from "../src/experiments/diffs/playground/model";
configureClipboard({
  async readText() {
    const command =
      process.platform === "darwin"
        ? ["pbpaste"]
        : ["wl-paste", "--no-newline"];
    const p = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
    const text = await new Response(p.stdout).text();
    if (await p.exited) throw Error(await new Response(p.stderr).text());
    return text;
  },
  async writeText(text) {
    const p = Bun.spawn(
      [process.platform === "darwin" ? "pbcopy" : "wl-copy"],
      { stdin: "pipe", stderr: "pipe" },
    );
    p.stdin.write(text);
    p.stdin.end();
    if (await p.exited) throw Error(await new Response(p.stderr).text());
  },
});
const model = new PlaygroundModel(process.env.PIERRE_PLAYGROUND_URL);
render(<PlaygroundApp model={model} />, {
  title: "Pierre Native",
  width: 1440,
  height: 1000,
});
