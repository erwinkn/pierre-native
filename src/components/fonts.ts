import { loadAsset } from "../platform";
import interRegular from "../../assets/fonts/Inter-Regular.ttf" with { type: "file" };
import interMedium from "../../assets/fonts/Inter-Medium.ttf" with { type: "file" };
import interSemiBold from "../../assets/fonts/Inter-SemiBold.ttf" with { type: "file" };
import interBold from "../../assets/fonts/Inter-Bold.ttf" with { type: "file" };
import monoRegular from "../../assets/fonts/JetBrainsMono-Regular.ttf" with { type: "file" };
import monoMedium from "../../assets/fonts/JetBrainsMono-Medium.ttf" with { type: "file" };
import monoSemiBold from "../../assets/fonts/JetBrainsMono-SemiBold.ttf" with { type: "file" };
import monoBold from "../../assets/fonts/JetBrainsMono-Bold.ttf" with { type: "file" };
import type { NativeRenderer } from "@gpuix/react";
const fonts = await Promise.all(
  [
    interRegular,
    interMedium,
    interSemiBold,
    interBold,
    monoRegular,
    monoMedium,
    monoSemiBold,
    monoBold,
  ].map(async (path) => loadAsset(path)),
);
const registered = new WeakSet<object>();
/** Fonts are read before mount and registered before any child layout or text measurement. */
export function ensureComponentFonts(renderer: NativeRenderer) {
  if (registered.has(renderer)) return;
  if (!renderer.registerFonts)
    throw Error(
      "This Pierre Native build requires the compatible GPUIX font binding.",
    );
  renderer.registerFonts(fonts);
  registered.add(renderer);
}
