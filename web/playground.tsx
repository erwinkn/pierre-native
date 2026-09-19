import { render } from "@gpuix/react";
import { PlaygroundApp } from "../src/experiments/diffs/playground/app";
import { PlaygroundModel } from "../src/experiments/diffs/playground/model";
const model = new PlaygroundModel(location.href);
const mode = matchMedia("(prefers-color-scheme: light)").matches
  ? "light"
  : "dark";
render(<PlaygroundApp model={model} systemMode={mode} />, {
  title: "Pierre Native playground",
  width: innerWidth,
  height: innerHeight,
});
Object.assign(globalThis, { pierrePlayground: model });
document.getElementById("loading")?.remove();
