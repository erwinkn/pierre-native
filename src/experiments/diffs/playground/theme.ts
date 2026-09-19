import { loadAsset } from "../../../platform";
import type { NativeRenderer } from "@gpuix/react";
import { bundledThemes } from "shiki";
import darkSoft from "@pierre/theme/pierre-dark-soft";
import lightSoft from "@pierre/theme/pierre-light-soft";
import { highlighter } from "../../../diffs/highlight";
import { resolveTheme } from "../../../diffs/theme";
import { darkTheme, lightTheme, type UITheme } from "../../../components/theme";
import {
  LIGHT_THEMES,
  DARK_THEMES,
} from "../../../../vendor/pierre-playground/searchParams";
import regular from "../../../../assets/playground/Geist-Regular.ttf" with { type: "file" };
import medium from "../../../../assets/playground/Geist-Medium.ttf" with { type: "file" };
import semibold from "../../../../assets/playground/Geist-SemiBold.ttf" with { type: "file" };
import bold from "../../../../assets/playground/Geist-Bold.ttf" with { type: "file" };
export { LIGHT_THEMES, DARK_THEMES };
await highlighter.loadTheme(darkSoft as any, lightSoft as any);
await Promise.all(
  [...LIGHT_THEMES, ...DARK_THEMES]
    .filter((n) => n in bundledThemes)
    .map(async (name) =>
      highlighter.loadTheme(
        (await bundledThemes[name as keyof typeof bundledThemes]()).default,
      ),
    ),
);
export const codeThemes = Object.fromEntries(
  [...LIGHT_THEMES, ...DARK_THEMES].map((name) => {
    const loaded = highlighter.getTheme(name);
    return [
      name,
      resolveTheme(
        loaded.type === "light" ? "light" : "dark",
        {},
        { name, colors: loaded.colors ?? {}, fg: loaded.fg, bg: loaded.bg },
      ),
    ];
  }),
);
const bytes = await Promise.all(
  [regular, medium, semibold, bold].map(async (path) => loadAsset(path)),
);
const installed = new WeakSet<object>();
export function ensurePlaygroundFonts(renderer: NativeRenderer) {
  if (installed.has(renderer)) return;
  renderer.registerFonts?.(bytes);
  installed.add(renderer);
}
export function playgroundTheme(light: boolean): UITheme {
  const base = light ? lightTheme : darkTheme;
  return {
    ...base,
    font: { ...base.font, sans: "Geist" },
    radius: { ...base.radius, control: 8 },
    colors: {
      ...base.colors,
      page: light ? "#ffffff" : "#0a0a0a",
      canvas: light ? "#ffffff" : "#0a0a0a",
      surface: light ? "#ffffff" : "#171717",
      field: light ? "#f5f5f5" : "#202020",
      inset: light ? "#f5f5f5" : "#202020",
      line: light ? "#e5e5e5" : "#262626",
      lineStrong: light ? "#d4d4d4" : "#404040",
      ink: light ? "#171717" : "#fafafa",
      secondary: light ? "#525252" : "#a3a3a3",
      muted: light ? "#737373" : "#a3a3a3",
      hover: light ? "#f5f5f5" : "#262626",
      segmentTrack: light ? "#f5f5f5" : "#262626",
      controlThumb: light ? "#ffffff" : "#0a0a0a",
    },
    overrides: {
      ...base.overrides,
      "pierre/Header": { fontFamily: "Geist" },
      "pierre/Annotation": { padding: 0, width: "100%" },
    },
  };
}
