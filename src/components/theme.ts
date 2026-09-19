import type { StyleDesc } from "@gpuix/react";
type BoxShadow = Exclude<NonNullable<StyleDesc["boxShadow"]>, unknown[]>;
/** Semantic tokens from Beautiful UI. Components do not own a second color system. */
export type UITheme = {
  name: string;
  colors: {
    page: string;
    canvas: string;
    surface: string;
    inset: string;
    field: string;
    segmentTrack: string;
    controlThumb: string;
    hover: string;
    hoverStrong: string;
    ink: string;
    secondary: string;
    muted: string;
    line: string;
    lineStrong: string;
    accent: string;
    accentInk: string;
    accentTint: string;
    green: string;
    greenTint: string;
    orange: string;
    orangeTint: string;
    red: string;
    redTint: string;
  };
  elevation: Record<
    "hairline" | "button" | "card" | "raised" | "overlay" | "filled" | "inset",
    BoxShadow[]
  >;
  harness: {
    sidebarWidth: number;
    dockWidth: number;
    recordsDockWidth: number;
    minContentWidth: number;
    gap: number;
    readingWidth: number;
    introWidth: number;
    composerFade: number;
    tabWidth: number;
    paneHeaderHeight: number;
  };
  stream: {
    tailGraphemes: number;
    tailOpacity: number;
    caretWidth: number;
    caretBlinkMs: number;
  };
  badge: {
    rings: Record<"neutral" | "green" | "orange" | "red" | "accent", string>;
    monogram: string;
  };
  motion: {
    controlMs: number;
    menuMs: number;
    pressMs: number;
    shimmerMs: number;
    progressMs: number;
    ease: [number, number, number, number];
  };
  code: { keyword: string; literal: string; addWord: string; delWord: string };
  flow: {
    trigger: string;
    condition: string;
    gridSize: number;
    rowGap: number;
  };
  tags: Record<string, [string, string, string]>;
  status: Record<"todo" | "progress" | "done", [string, string, string]>;
  font: { sans: string; mono: string; scale: number };
  radius: { chip: number; control: number; card: number; window: number };
  layout: {
    componentWidth: number;
    wideWidth: number;
    mediaPreview: number;
    space: number;
  };
  /** component, component/PartName, or #instance-id; merged in that order. */
  overrides: Record<string, StyleDesc>;
};
const shadow = (
  y: number,
  blur: number,
  spread: number,
  color: string,
  inset = false,
): BoxShadow => ({
  offsetX: 0,
  offsetY: y,
  blurRadius: blur,
  spreadRadius: spread,
  color,
  inset,
});
export const darkTheme: UITheme = {
  name: "Dark",
  harness: {
    sidebarWidth: 224,
    dockWidth: 360,
    recordsDockWidth: 400,
    minContentWidth: 320,
    gap: 10,
    readingWidth: 720,
    introWidth: 620,
    composerFade: 32,
    tabWidth: 144,
    paneHeaderHeight: 44,
  },
  stream: {
    tailGraphemes: 6,
    tailOpacity: 0.25,
    caretWidth: 2,
    caretBlinkMs: 1000,
  },
  badge: {
    rings: {
      neutral: "#2e3033",
      green: "#3cbb7247",
      orange: "#f68f3c47",
      red: "#ee5c6147",
      accent: "#3d9aff47",
    },
    monogram: "#e08a3c",
  },
  motion: {
    controlMs: 200,
    menuMs: 220,
    pressMs: 150,
    shimmerMs: 1800,
    progressMs: 400,
    ease: [0.23, 1, 0.32, 1],
  },
  elevation: {
    hairline: [shadow(0, 0, 1, "#2e3033")],
    button: [shadow(0, 0, 1, "#ffffff1a"), shadow(1, 2, 0, "#0000004d")],
    card: [
      shadow(0, 0, 1, "#ffffff1c"),
      shadow(1, 2, 0, "#00000033"),
      shadow(2, 6, 0, "#00000033"),
    ],
    raised: [shadow(0, 0, 1, "#ffffff21"), shadow(2, 10, 0, "#00000038")],
    overlay: [shadow(0, 0, 1, "#ffffff26"), shadow(8, 28, 0, "#00000057")],
    filled: [shadow(1, 0, 0, "#ffffff24", true)],
    inset: [shadow(1, 2, 0, "#00000066", true)],
  },
  code: {
    keyword: "#7ec0ff",
    literal: "#f68f3c",
    addWord: "#3cbb722e",
    delWord: "#ee5c612e",
  },
  flow: { trigger: "#9a5cff", condition: "#f09a2f", gridSize: 22, rowGap: 64 },
  colors: {
    page: "#17181a",
    canvas: "#1c1d1f",
    surface: "#232427",
    inset: "#1f2022",
    field: "#2b2c2f",
    segmentTrack: "#2e303399",
    controlThumb: "#ffffff",
    hover: "#2a2b2e",
    hoverStrong: "#313236",
    ink: "#f2f3f4",
    secondary: "#a5a8ad",
    muted: "#6c6f75",
    line: "#2e3033",
    lineStrong: "#3a3c40",
    accent: "#3d9aff",
    accentInk: "#7ec0ff",
    accentTint: "#3e9bff29",
    green: "#3cbb72",
    greenTint: "#39b87124",
    orange: "#f68f3c",
    orangeTint: "#f18e3924",
    red: "#ee5c61",
    redTint: "#ea5c6324",
  },
  status: {
    todo: ["#694c2a", "#f2a84c", "#694c2a"],
    progress: ["#1f505d", "#37b2cf", "#1f505d"],
    done: ["#245143", "#44b48b", "#245143"],
  },
  tags: {
    B2B: ["#654f33", "#e9ae64", "#654f33"],
    Wholesale: ["#654f33", "#e9ae64", "#654f33"],
    B2C: ["#4f5a2f", "#b0cc5a", "#4f5a2f"],
    Vegan: ["#4f5a2f", "#b0cc5a", "#4f5a2f"],
    Cafe: ["#663332", "#ec6962", "#663332"],
    Catering: ["#5c3764", "#d372e0", "#5c3764"],
    "Dairy-free": ["#335561", "#6abed7", "#335561"],
    Gelato: ["#473c68", "#9d80ea", "#473c68"],
    Imports: ["#68422e", "#f29057", "#68422e"],
    Local: ["#2c5647", "#5ac196", "#2c5647"],
    Seasonal: ["#5f592c", "#d9c953", "#5f592c"],
    Sorbet: ["#683549", "#f16f9a", "#683549"],
  },
  font: { sans: "Inter", mono: "JetBrains Mono", scale: 1 },
  radius: { chip: 6, control: 8, card: 10, window: 14 },
  layout: { componentWidth: 380, wideWidth: 580, mediaPreview: 224, space: 4 },
  overrides: {},
};
export const lightTheme: UITheme = {
  ...darkTheme,
  name: "Light",
  badge: {
    rings: {
      neutral: "#ebedf0",
      green: "#23974e47",
      orange: "#d7741647",
      red: "#df474d47",
      accent: "#218cf547",
    },
    monogram: "#e08a3c",
  },
  elevation: {
    hairline: [shadow(0, 0, 1, "#ebedf0")],
    button: [shadow(0, 0, 1, "#dfe2e6"), shadow(0, 4, 0, "#0000000a")],
    card: [
      shadow(0, 0, 1, "#ebedf0"),
      shadow(18, 47, 0, "#00000008"),
      shadow(7.5, 19, 0, "#00000005"),
      shadow(4, 10.5, 0, "#00000005"),
      shadow(2.3, 5.8, 0, "#00000003"),
      shadow(1.2, 3.1, 0, "#00000003"),
      shadow(0.5, 1.3, 0, "#00000003"),
    ],
    raised: [
      shadow(0, 0, 1, "#ebedf0"),
      shadow(17.54, 23.39, 0, "#0000000a"),
      shadow(9.4, 12.5, 0, "#00000008"),
      shadow(5.25, 7, 0, "#00000005"),
      shadow(2.79, 3.72, -2, "#00000003"),
      shadow(1.16, 1.5, 0, "#00000003"),
    ],
    overlay: [
      shadow(0, 0, 1, "#ebedf0"),
      shadow(25, 50, 0, "#0000000d"),
      shadow(12, 24, 0, "#0000000a"),
      shadow(6, 12, 0, "#00000008"),
      shadow(3, 6, 0, "#00000005"),
      shadow(1.5, 3, 0, "#00000005"),
    ],
    filled: [shadow(1, 0, 0, "#ffffff24", true)],
    inset: [shadow(1, 2, 0, "#0000001f", true)],
  },
  code: {
    keyword: "#1479b8",
    literal: "#d47720",
    addWord: "#2298552e",
    delWord: "#d9434c2e",
  },
  status: {
    todo: ["#fcebd5", "#df902e", "#faddb8"],
    progress: ["#d0edf4", "#179bba", "#b0e1ec"],
    done: ["#d3eee4", "#259d71", "#b5e1d1"],
  },
  tags: {
    B2B: ["#faeedf", "#d69748", "#f7e1c5"],
    Wholesale: ["#faeedf", "#d69748", "#f7e1c5"],
    B2C: ["#eef4dc", "#99b63d", "#e2ecc2"],
    Vegan: ["#eef4dc", "#99b63d", "#e2ecc2"],
    Cafe: ["#fbe0de", "#d94d45", "#f8c7c4"],
    Catering: ["#f6e1f8", "#be56cc", "#efcaf3"],
    "Dairy-free": ["#e0f1f7", "#4ea7c3", "#c8e7f0"],
    Gelato: ["#eae4fb", "#8465d7", "#dad0f7"],
    Imports: ["#fce8dc", "#df763a", "#fad6c1"],
    Local: ["#dcf2e9", "#3dab7d", "#c2e8d8"],
    Seasonal: ["#f7f4db", "#c5b336", "#f1ebbf"],
    Sorbet: ["#fce1ea", "#de5382", "#fac9da"],
  },
  colors: {
    page: "#fafafa",
    canvas: "#f1f2f3",
    surface: "#ffffff",
    inset: "#f8f9fa",
    field: "#f2f2f3",
    segmentTrack: "#ebedf099",
    controlThumb: "#ffffff",
    hover: "#f5f6f7",
    hoverStrong: "#e8e9ea",
    ink: "#202226",
    secondary: "#626670",
    muted: "#989ca4",
    line: "#ebedf0",
    lineStrong: "#dfe2e6",
    accent: "#218cf5",
    accentInk: "#1674d0",
    accentTint: "#ebf5ff",
    green: "#23974e",
    greenTint: "#e9f6ef",
    orange: "#d77416",
    orangeTint: "#fff2e5",
    red: "#df474d",
    redTint: "#fff0f0",
  },
};
