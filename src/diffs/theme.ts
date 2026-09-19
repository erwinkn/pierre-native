import dark from "@pierre/theme/pierre-dark";
import light from "@pierre/theme/pierre-light";
import { interpolate, formatHex, formatHex8, parse, converter } from "culori";
export type DiffTheme = {
  name: string;
  mode: "dark" | "light";
  foreground: string;
  background: string;
  number: string;
  addition: string;
  deletion: string;
  modified: string;
  addBackground: string;
  delBackground: string;
  addGutter: string;
  delGutter: string;
  addWord: string;
  delWord: string;
  buffer: string;
  context: string;
  contextGutter: string;
  separator: string;
  selection: string;
  caret: string;
  activeLine: string;
  markerColors?: Record<"error" | "warning" | "info" | "hint", string>;
};
export function mix(a: string, b: string, amount: number) {
  return formatHex(interpolate([a, b], "lab")(amount));
}
export function alpha(value: string, opacity: number) {
  return formatHex8({ ...parse(value)!, alpha: opacity });
}
export function resolveTheme(
  mode: "dark" | "light" = "dark",
  override: Partial<DiffTheme> = {},
  source?: {
    name: string;
    colors: Record<string, string | undefined>;
    fg?: string;
    bg?: string;
  },
): DiffTheme {
  const theme = mode === "dark" ? dark : light,
    c = {
      ...theme.colors,
      ...Object.fromEntries(
        Object.entries(source?.colors ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    };
  if (source?.fg) c["editor.foreground"] = source.fg;
  if (source?.bg) c["editor.background"] = source.bg;
  const bg = c["editor.background"],
    fg = c["editor.foreground"],
    mixer = mode === "dark" ? "#ffffff" : "#000000";
  const addition = c["gitDecoration.addedResourceForeground"],
    deletion = c["gitDecoration.deletedResourceForeground"],
    modified = c["gitDecoration.modifiedResourceForeground"];
  const amount = mode === "dark" ? 0.2 : 0.12,
    context = mix(bg, mixer, mode === "dark" ? 0.075 : 0.015);
  return {
    name: source?.name ?? theme.name,
    mode,
    foreground: fg,
    background: bg,
    number: mix(fg, bg, 0.35),
    addition,
    deletion,
    modified,
    addBackground: mix(bg, addition, amount),
    delBackground: mix(bg, deletion, amount),
    addGutter: mix(bg, addition, mode === "dark" ? 0.15 : 0.09),
    delGutter: mix(bg, deletion, mode === "dark" ? 0.15 : 0.09),
    addWord: alpha(addition, mode === "dark" ? 0.2 : 0.15),
    delWord: alpha(deletion, mode === "dark" ? 0.2 : 0.15),
    buffer: mix(bg, mixer, 0.08),
    context,
    contextGutter: mix(context, bg, mode === "dark" ? 0.55 : 0.1),
    separator: mix(bg, mixer, mode === "dark" ? 0.15 : 0.04),
    selection: c["editor.selectionBackground"],
    caret: c["editorCursor.foreground"],
    activeLine: c["editor.lineHighlightBackground"],
    markerColors: {
      error: c["editorError.foreground"] ?? deletion,
      warning:
        c["editorWarning.foreground"] ??
        (mode === "dark" ? "#ffd452" : "#d5a910"),
      info: c["editorInfo.foreground"] ?? modified,
      hint: c["editorHint.foreground"] ?? mix(fg, bg, 0.35),
    },
    ...override,
  };
}
export const pierreDark = resolveTheme("dark"),
  pierreLight = resolveTheme("light");

export function markerColor(
  theme: DiffTheme,
  severity: "error" | "warning" | "info" | "hint",
) {
  return (
    theme.markerColors?.[severity] ??
    {
      error: theme.deletion,
      warning: theme.mode === "dark" ? "#ffd452" : "#d5a910",
      info: theme.modified,
      hint: theme.number,
    }[severity]
  );
}
export function markerContrast(color: string) {
  const rgb = converter("rgb")(color)!;
  const linear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
