import stripVTControlCharacters from "strip-ansi";
import { diffChars, diffWordsWithSpace } from "diff";
import {
  iterateOverDiff,
  type FileContents,
  type FileDiffMetadata,
  type HunkExpansionRegion,
  type BaseDiffOptions,
} from "./core";
import { pushOrJoinSpan } from "../../vendor/pierre/src/utils/parseDiffDecorations";
import { highlight, type NativeToken } from "./highlight";
import { type DiffTheme } from "./theme";
export type CodeCell = {
  owner?: string;
  text: string;
  number?: number;
  otherNumber?: number;
  start?: number;
  side: "additions" | "deletions";
  kind: "context" | "addition" | "deletion";
  tokens: NativeToken[];
  background?: string;
  gutterBackground?: string;
  numberColor?: string;
  noEol?: boolean;
};
export type CodeRow = {
  owner?: string;
  sticky?: boolean;
  separatorStyle?: string;
  marginTop?: number;
  id: string;
  left?: CodeCell;
  right?: CodeCell;
  label?: string;
  height?: number;
  action?: string;
  kind?: string;
  hunkIndex?: number;
  collapsed?: number;
  slot?: number;
  slotSide?: string;
  overlay?: boolean;
  slotInset?: number;
  slotAnchor?: string;
  slotWidth?: number;
  slotOffset?: number;
};
export type DiffOptions = Omit<
  BaseDiffOptions,
  | "unsafeCSS"
  | "theme"
  | "useCSSClasses"
  | "useTokenTransformer"
  | "preferredHighlighter"
  | "disableVirtualizationBuffers"
> & {
  lineHoverHighlight?: "disabled" | "both" | "number" | "line";
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  theme?: DiffTheme;
  showHunkActions?: boolean;
};
export function offsets(lines: string[]) {
  let n = 0;
  return lines.map((line) => {
    const a = n;
    n += line.length;
    return a;
  });
}
const clean = (line: string) => {
  const last = line.charCodeAt(line.length - 1);
  return last === 10
    ? line.slice(0, line.charCodeAt(line.length - 2) === 13 ? -2 : -1)
    : last === 13
      ? line.slice(0, -1)
      : line;
};
export function fileRows(
  file: FileContents,
  theme: DiffTheme,
  editable = false,
  options: DiffOptions = {},
): CodeRow[] {
  const tokens = highlight(
    editable && file.lang === "ansi" ? { ...file, lang: "text" } : file,
    theme.name,
    "file",
    options,
  );
  const lines = file.contents
    .match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)
    ?.filter((line, i, all) => line !== "" || i < all.length - 1) ?? [""];
  if (!lines.length) lines.push("");
  if (editable && /[\r\n]$/.test(file.contents)) lines.push("");
  const starts = offsets(
    file.lang === "ansi" && !editable
      ? lines.map(stripVTControlCharacters)
      : lines,
  );
  return lines.map((text, i) => ({
    id: `line-${i}`,
    left: {
      text:
        file.lang === "ansi" && !editable
          ? stripVTControlCharacters(clean(text))
          : clean(text),
      number: i + 1,
      start: starts[i],
      side: "additions",
      kind: "context",
      tokens: tokens[i] ?? [],
    },
  }));
}
export function wordRanges(
  before: string,
  after: string,
  type = "word-alt",
  maxLength = 1000,
): { before: [number, number][]; after: [number, number][] } {
  const result: { before: [number, number][]; after: [number, number][] } = {
    before: [],
    after: [],
  };
  if (type === "none" || before.length > maxLength || after.length > maxLength)
    return result;
  const changes =
      type === "char"
        ? diffChars(before, after)
        : diffWordsWithSpace(before, after),
    a: [0 | 1, string][] = [],
    b: [0 | 1, string][] = [];
  for (const item of changes) {
    const options = {
      item,
      enableJoin: type === "word-alt",
      isLastItem: item === changes.at(-1),
    };
    if (!item.added && !item.removed) {
      pushOrJoinSpan({ ...options, arr: a, isNeutral: true });
      pushOrJoinSpan({ ...options, arr: b, isNeutral: true });
    } else pushOrJoinSpan({ ...options, arr: item.removed ? a : b });
  }
  for (const [spans, key] of [
    [a, "before"],
    [b, "after"],
  ] as const) {
    let offset = 0;
    for (const [changed, text] of spans) {
      if (changed) result[key].push([offset, offset + text.length]);
      offset += text.length;
    }
  }
  return result;
}
function decorate(
  tokens: NativeToken[],
  ranges: [number, number][],
  background: string,
  text: string,
  color: string,
): NativeToken[] {
  if (!ranges.length) return tokens;
  const boundaries = new Set([
    0,
    text.length,
    ...ranges.flat(),
    ...tokens.flatMap((t) => [t.start, t.end]),
  ]);
  const ordered = [...boundaries].sort((a, b) => a - b),
    result: NativeToken[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const start = ordered[i],
      end = ordered[i + 1],
      token = tokens.find((t) => t.start <= start && t.end >= end);
    if (end > start)
      result.push({
        ...token,
        start,
        end,
        color: token?.color ?? color,
        background: ranges.some(([a, b]) => a <= start && b >= end)
          ? background
          : token?.background,
      });
  }
  return result;
}
export function diffRows(
  diff: FileDiffMetadata,
  theme: DiffTheme,
  options: DiffOptions = {},
  expanded?: Map<number, HunkExpansionRegion> | true,
): CodeRow[] {
  const rows: CodeRow[] = [];
  const split = options.diffStyle !== "unified";
  const oldStarts = offsets(diff.deletionLines),
    newStarts = offsets(diff.additionLines);
  const oldTokens = highlight(
      {
        name: diff.prevName ?? diff.name,
        contents: diff.deletionLines.join(""),
        lang: diff.lang,
      },
      theme.name,
      "deletions",
      options,
    ),
    newTokens = highlight(
      {
        name: diff.name,
        contents: diff.additionLines.join(""),
        lang: diff.lang,
      },
      theme.name,
      "additions",
      options,
    );
  const decorations = new Map<string, [number, number][]>();
  iterateOverDiff({
    diff,
    diffStyle: "split",
    expandedHunks: expanded ?? (options.expandUnchanged ? true : undefined),
    callback: (r) => {
      if (r.type === "change" && r.deletionLine && r.additionLine) {
        const a = wordRanges(
          clean(diff.deletionLines[r.deletionLine.lineIndex] ?? ""),
          clean(diff.additionLines[r.additionLine.lineIndex] ?? ""),
          options.lineDiffType,
          options.maxLineDiffLength,
        );
        decorations.set(`d${r.deletionLine.lineIndex}`, a.before);
        decorations.set(`a${r.additionLine.lineIndex}`, a.after);
      }
    },
  });
  const cell = (
    side: "additions" | "deletions",
    i: number,
    n: number,
    changed: boolean,
    noEol: boolean,
  ): CodeCell => {
    const addition = side === "additions",
      text = clean(
        (addition ? diff.additionLines : diff.deletionLines)[i] ?? "",
      );
    const tokens = (addition ? newTokens : oldTokens)[i] ?? [];
    return {
      text,
      number: n,
      start: (addition ? newStarts : oldStarts)[i],
      side,
      kind: changed ? (addition ? "addition" : "deletion") : "context",
      noEol,
      tokens: decorate(
        tokens,
        decorations.get(`${addition ? "a" : "d"}${i}`) ?? [],
        addition ? theme.addWord : theme.delWord,
        text,
        theme.foreground,
      ),
      background:
        !options.disableBackground && changed
          ? addition
            ? theme.addBackground
            : theme.delBackground
          : undefined,
      gutterBackground:
        !options.disableBackground && changed
          ? addition
            ? theme.addGutter
            : theme.delGutter
          : undefined,
      numberColor: changed
        ? addition
          ? theme.addition
          : theme.deletion
        : theme.number,
    };
  };
  let lastHunk = -1;
  const separator = (
    hunk: number,
    count: number,
    metadata?: string,
    trailing = false,
  ) => {
    const style = options.hunkSeparators ?? "line-info";
    const simple = style === "simple";
    rows.push({
      id: `separator-${hunk}-${trailing ? "after" : "before"}`,
      label: simple
        ? ""
        : style === "metadata"
          ? (metadata?.trim() ?? `${count} unmodified lines`)
          : `${count} unmodified ${count === 1 ? "line" : "lines"}`,
      kind: "separator",
      height: simple
        ? 4
        : style === "line-info"
          ? 32 + (rows.length ? 8 : 0) + (trailing ? 0 : 8)
          : 32,
      separatorStyle: style,
      marginTop: style === "line-info" && rows.length ? 8 : 0,
      action: diff.isPartial
        ? options.loadDiffFiles
          ? `hydrate:${hunk}`
          : undefined
        : `expand:${hunk}:${trailing ? "up" : "both"}`,
      hunkIndex: hunk,
      collapsed: count,
    });
  };
  iterateOverDiff({
    diff,
    diffStyle: split ? "split" : "unified",
    expandedHunks: expanded ?? (options.expandUnchanged ? true : undefined),
    collapsedContextThreshold: options.collapsedContextThreshold,
    callback: (r) => {
      if (r.collapsedBefore > 0)
        separator(r.hunkIndex, r.collapsedBefore, r.hunk?.hunkSpecs);
      if (options.showHunkActions && r.hunkIndex !== lastHunk && r.hunk) {
        rows.push({
          id: `actions-${r.hunkIndex}`,
          label: "Accept change     Reject change",
          height: 28,
          kind: "actions",
          action: `hunk:${r.hunkIndex}`,
          hunkIndex: r.hunkIndex,
        });
      }
      lastHunk = r.hunkIndex;
      const deletion =
          r.deletionLine &&
          cell(
            "deletions",
            r.deletionLine.lineIndex,
            r.deletionLine.lineNumber,
            r.type === "change",
            r.deletionLine.noEOFCR,
          ),
        addition =
          r.additionLine &&
          cell(
            "additions",
            r.additionLine.lineIndex,
            r.additionLine.lineNumber,
            r.type === "change",
            r.additionLine.noEOFCR,
          );
      if (split)
        rows.push({
          id: `split-${r.deletionLine?.lineNumber ?? "x"}-${r.additionLine?.lineNumber ?? "x"}`,
          left: deletion,
          right: addition,
          hunkIndex: r.hunkIndex,
        });
      else {
        const one = addition ?? deletion!;
        one.otherNumber = r.type !== "change" ? deletion?.number : undefined;
        rows.push({
          id: `unified-${r.deletionLine?.lineNumber ?? "x"}-${r.additionLine?.lineNumber ?? "x"}`,
          left: one,
          hunkIndex: r.hunkIndex,
        });
      }
      if (deletion?.noEol || addition?.noEol)
        rows.push({
          id: `eof-${rows.length}`,
          label: "No newline at end of file",
          height: 20,
          kind: "eof",
        });
      if (r.collapsedAfter > 0)
        separator(r.hunkIndex + 1, r.collapsedAfter, undefined, true);
    },
  });
  if (!rows.length)
    rows.push({
      id: "empty",
      label:
        diff.type === "rename-pure"
          ? "File renamed without changes"
          : "No changes",
      height: 40,
      kind: "empty",
    });
  return rows;
}

/** Expand only the context region that contains the requested additions line. */
export function expandToLine(
  diff: FileDiffMetadata,
  current: Map<number, HunkExpansionRegion>,
  line: number,
) {
  if (diff.isPartial || line < 1 || line > diff.additionLines.length)
    return current;
  const next = new Map(current),
    index = diff.hunks.findIndex((h) => h.additionStart > line);
  if (index >= 0) {
    const old = next.get(index) ?? { fromStart: 0, fromEnd: 0 };
    next.set(index, {
      ...old,
      fromEnd: Math.max(
        old.fromEnd,
        diff.hunks[index].additionStart - line + 1,
      ),
    });
  } else {
    const h = diff.hunks.at(-1);
    if (!h) return current;
    const old = next.get(diff.hunks.length) ?? { fromStart: 0, fromEnd: 0 };
    next.set(diff.hunks.length, {
      ...old,
      fromStart: Math.max(
        old.fromStart,
        line - (h.additionStart + h.additionCount - 1),
      ),
    });
  }
  return next;
}
