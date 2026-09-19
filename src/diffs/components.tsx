import stripVTControlCharacters from "strip-ansi";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import {
  Action,
  Box,
  Label,
  Part,
  Input,
  Glyph,
  useUI,
  row,
  column,
} from "../components/foundation";
import { predictionGroups } from "./prediction";
import { DocumentBridge } from "./bridge";
import sourceIcons from "./icons.json";
import { Editor, type NativeCodeEvent, type Marker } from "./editor";
import { highlight } from "./highlight";
import { findBracketMatchRanges } from "../../vendor/pierre/src/editor/matchBrackets";
import { getLineAnnotationSource } from "../../vendor/pierre/src/utils/lineAnnotationIdentity";
import { getCaretPosition } from "../../vendor/pierre/src/editor/selection";
import {
  fileRows,
  diffRows,
  expandToLine,
  type CodeRow,
  type DiffOptions,
} from "./layout";
import {
  pierreDark,
  pierreLight,
  alpha,
  mix,
  markerColor,
  markerContrast,
  type DiffTheme,
} from "./theme";
import {
  parseDiffFromFile,
  parsePatchFiles,
  diffAcceptRejectHunk,
  parseMergeConflictDiffFromFile,
  resolveConflict,
  type FileContents,
  type FileDiffMetadata,
  type HunkExpansionRegion,
  type SelectedLineRange,
  type LineAnnotation,
  type DiffLineAnnotation,
} from "./core";
import { hydratePartialDiff } from "../../vendor/pierre/src/utils/hydratePartialDiff";
import { systemClipboard as clipboard } from "./clipboard";
export type AnyEditor = Editor<any, any>;
const controllerIds = new WeakMap<AnyEditor, number>();
let nextControllerId = 0;
function controllerId(editor: AnyEditor) {
  let id = controllerIds.get(editor);
  if (id === undefined) {
    id = ++nextControllerId;
    controllerIds.set(editor, id);
  }
  return id;
}
export type CommonCodeProps = {
  id?: string;
  options?: DiffOptions;
  editor?: AnyEditor;
  edit?: boolean;
  editStateKey?: string;
  enableLineSelection?: boolean;
  onLineEnter?: (line: { lineNumber: number; side: string }) => void;
  onLineLeave?: (line: { lineNumber: number; side: string }) => void;
  onTokenClick?: (token: {
    text: string;
    lineNumber: number;
    side: string;
    start: number;
    end: number;
  }) => void;
  onRequestEdit?: (editor: AnyEditor) => void;
  getAnnotationKey?: (annotation: any) => string | number;
  renderMarker?: (marker: Marker) => ReactNode;
  renderSelectionAction?: (context: {
    editor: AnyEditor;
    text: string;
  }) => ReactNode;

  onEditChange?: (file: FileContents) => void;
  onEditComplete?: (file: FileContents) => "accept" | "reject" | void;
  selectedLines?: SelectedLineRange | null;
  onLineSelect?: (range: SelectedLineRange | null) => void;
  onLineClick?: (line: {
    lineNumber: number;
    side: "additions" | "deletions";
  }) => void;
  renderHeader?: (file: FileContents | FileDiffMetadata) => ReactNode;
  renderHeaderMetadata?: (file: FileContents | FileDiffMetadata) => ReactNode;
  renderHeaderPrefix?: (file: FileContents | FileDiffMetadata) => ReactNode;
  renderHeaderFilenameSuffix?: (
    file: FileContents | FileDiffMetadata,
  ) => ReactNode;
  renderGutterUtility?: (line: {
    lineNumber: number;
    side: string;
    owner?: string;
  }) => ReactNode;
  renderAnnotation?: (annotation: unknown) => ReactNode;
  lineAnnotations?: (LineAnnotation<any> | DiffLineAnnotation<any>)[];
  height?: number | string;
  onReady?: (editor: AnyEditor) => void;
  onFocus?: (editor: AnyEditor) => void;
  onBlur?: (editor: AnyEditor) => void;
};
export type FileProps = CommonCodeProps & { file: FileContents };
export type FileDiffProps = CommonCodeProps & {
  oldFile?: FileContents | null;
  newFile?: FileContents | null;
  fileDiff?: FileDiffMetadata;
  onDiffChange?: (diff: FileDiffMetadata) => void;
  onHunkAction?: (
    hunk: number,
    action: "accept" | "reject",
    diff: FileDiffMetadata,
  ) => void;
};
function useCodeTheme(options: DiffOptions | undefined) {
  const { theme } = useUI();
  return (
    options?.theme ??
    (options?.themeType === "light" ||
    (options?.themeType !== "dark" &&
      theme.name.toLowerCase().includes("light"))
      ? pierreLight
      : pierreDark)
  );
}
const annotationIds = new WeakMap<object, number>();
let nextAnnotationId = 0;
function annotationKey(
  annotation: LineAnnotation<any> | DiffLineAnnotation<any>,
  props: CommonCodeProps,
) {
  if (props.getAnnotationKey)
    return `annotation-${props.getAnnotationKey(annotation)}`;
  const original = getLineAnnotationSource(annotation);
  let id = annotationIds.get(original);
  if (id === undefined) annotationIds.set(original, (id = ++nextAnnotationId));
  return `annotation-${id}`;
}
const rowStyle = row;
const defaultOptions: DiffOptions = Object.freeze({});
const buttonStyle = { padding: 4, borderWidth: 0, borderRadius: 4 };
function Control({
  id,
  label,
  onPress,
  children,
  disabled,
}: {
  id: string;
  label: string;
  onPress: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Action
      id={id}
      label={label}
      component="pierre"
      name="HeaderActions"
      disabled={disabled}
      onPress={onPress}
      style={buttonStyle}
    >
      {children ?? <Label size={12}>{label}</Label>}
    </Action>
  );
}
function Search({
  editor,
  id,
  onRequestEdit,
}: {
  editor: AnyEditor;
  id: string;
  onRequestEdit?: (editor: AnyEditor) => void;
}) {
  const search = editor.search;
  const input = useRef<PublicInstance | null>(null),
    native = useGpuixRequired();
  useLayoutEffect(() => {
    if (input.current) native.focusElement?.(input.current.id);
  }, [search.mode, native]);
  return (
    <Part
      component="pierre"
      name="Search"
      id={`${id}/search`}
      role="search"
      style={{
        ...column,
        gap: 6,
        padding: 8,
        borderBottomWidth: 1,
        borderColor: "#555555",
        flexShrink: 0,
      }}
    >
      <Box style={{ ...row, gap: 6, flexWrap: "wrap" }}>
        <Control
          id={`${id}/search/toggle-replace`}
          label={search.mode === "replace" ? "Hide replace" : "Show replace"}
          onPress={() => {
            const mode = search.mode === "replace" ? "find" : "replace";
            if (mode === "replace" && editor.options.readOnly)
              onRequestEdit?.(editor);
            editor.setSearchMode(mode);
          }}
        >
          <Glyph
            name={search.mode === "replace" ? "down" : "right"}
            size={14}
          />
        </Control>
        <Input
          inputRef={input}
          component="pierre"
          name="SearchInput"
          id={`${id}/search/query`}
          value={search.text}
          onChange={(text) => editor.updateSearch({ text })}
          placeholder="Find"
          onSubmit={() => editor.navigateSearch()}
          onKeyDown={(e) => {
            if (e.key === "escape") editor.closeSearch();
          }}
          style={{ width: 240, maxWidth: "100%" }}
        />
        {(["caseSensitive", "wholeWord", "regex"] as const).map((key, i) => (
          <Control
            key={key}
            id={`${id}/search/${key}`}
            label={["Match case", "Whole word", "Regular expression"][i]}
            onPress={() => editor.updateSearch({ [key]: !search[key] })}
          >
            <Label size={12} style={{ opacity: search[key] ? 1 : 0.5 }}>
              {["Aa", "ab", ".*"][i]}
            </Label>
          </Control>
        ))}
        <Label size={12}>
          {search.matches.length
            ? `${Math.max(0, search.index) + 1} of ${search.matches.length}`
            : "No results"}
        </Label>
        <Control
          id={`${id}/search/previous`}
          label="Previous match"
          onPress={() => editor.navigateSearch(true)}
        >
          <Glyph name="up" size={14} />
        </Control>
        <Control
          id={`${id}/search/next`}
          label="Next match"
          onPress={() => editor.navigateSearch()}
        >
          <Glyph name="down" size={14} />
        </Control>
        <Control
          id={`${id}/search/close`}
          label="Close search"
          onPress={() => editor.closeSearch()}
        >
          <Glyph name="close" size={14} />
        </Control>
      </Box>
      {search.mode === "replace" && (
        <Box style={{ ...row, gap: 6, flexWrap: "wrap" }}>
          <Input
            component="pierre"
            name="ReplaceInput"
            id={`${id}/search/replacement`}
            value={search.replaceText}
            onChange={(replaceText) => editor.updateSearch({ replaceText })}
            placeholder="Replace"
            style={{ width: 240, maxWidth: "100%" }}
          />
          <Control
            id={`${id}/search/replace`}
            label="Replace"
            disabled={
              editor.options.readOnly ||
              !search.matches.length ||
              !!search.error
            }
            onPress={() => editor.replaceMatch()}
          />
          <Control
            id={`${id}/search/replace-all`}
            label="Replace all"
            disabled={
              editor.options.readOnly ||
              !search.matches.length ||
              !!search.error
            }
            onPress={() => editor.replaceMatch(true)}
          />
        </Box>
      )}
      {search.mode === "replace" && editor.options.readOnly && (
        <Label size={12} tone="muted">
          This file is read-only.
        </Label>
      )}
      {search.error && <Label tone="red">{search.error}</Label>}
    </Part>
  );
}
function Header({
  id,
  file,
  theme,
  props,
  editor,
  collapsed,
  toggle,
}: {
  id: string;
  file: FileContents | FileDiffMetadata;
  theme: DiffTheme;
  props: CommonCodeProps;
  editor: AnyEditor;
  collapsed: boolean;
  toggle: () => void;
}) {
  if (props.options?.disableFileHeader) return null;
  const diff = "hunks" in file ? file : undefined,
    added = diff?.hunks.reduce((n, h) => n + h.additionLines, 0) ?? 0,
    removed = diff?.hunks.reduce((n, h) => n + h.deletionLines, 0) ?? 0;
  return (
    <Part
      component="pierre"
      name="Header"
      id={`${id}/header`}
      data={file}
      style={{
        ...row,
        width: "100%",
        minWidth: 0,
        height: 44,
        backgroundColor: theme.background,
        flexShrink: 0,
        paddingLeft: 16,
        paddingRight: 16,
        gap: 8,
      }}
    >
      {props.renderHeader ? (
        props.renderHeader(file)
      ) : (
        <>
          <Part
            component="pierre"
            name="HeaderActions"
            id={`${id}/collapse`}
            as="svg"
            tabIndex={0}
            aria-label={collapsed ? "Expand file" : "Collapse file"}
            onClick={toggle}
            nativeProps={{
              source:
                sourceIcons[
                  diff
                    ? diff.type === "new"
                      ? "symbol-added"
                      : diff.type === "deleted"
                        ? "symbol-deleted"
                        : diff.prevName
                          ? "symbol-moved"
                          : "symbol-modified"
                    : "file-code"
                ],
            }}
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              color: diff ? theme.modified : theme.number,
            }}
          />
          {props.renderHeaderPrefix?.(file)}
          <Part
            component="pierre"
            name="Filename"
            id={`${id}/filename`}
            style={{ ...row, gap: 8, flexGrow: 1, minWidth: 0 }}
          >
            {diff?.prevName && (
              <Label size={13} style={{ color: theme.number, lineClamp: 1 }}>
                {diff.prevName + " →"}
              </Label>
            )}
            <Label
              size={13}
              style={{
                color: theme.foreground,
                fontWeight: 400,
                fontFamily: "Inter",
                lineHeight: 20,
                lineClamp: 1,
              }}
            >
              {file.name}
            </Label>
            {props.renderHeaderFilenameSuffix?.(file)}
          </Part>
          {diff && (
            <Part
              component="pierre"
              name="ChangeCounts"
              id={`${id}/counts`}
              style={{ ...row, gap: 8 }}
            >
              <Label
                mono
                size={13}
                style={{ color: theme.deletion, fontWeight: 400 }}
              >{`-${removed}`}</Label>
              <Label
                mono
                size={13}
                style={{ color: theme.addition, fontWeight: 400 }}
              >{`+${added}`}</Label>
            </Part>
          )}
          {props.renderHeaderMetadata?.(file)}
        </>
      )}
    </Part>
  );
}
function Surface({
  props,
  file,
  editor,
  rows,
  diff,
  onAction,
  collection,
}: {
  props: CommonCodeProps;
  file: FileContents | FileDiffMetadata;
  editor: AnyEditor;
  rows: CodeRow[];
  diff?: FileDiffMetadata;
  onAction?: (event: NativeCodeEvent, row: CodeRow) => void;
  collection?: {
    text: string;
    oldText: string;
    offset: number;
    oldOffset: number;
    owner: string;
    split: boolean;
    slots: ReactNode[];
    attachFocus: (focus: (value: boolean) => void) => () => void;
    event: (
      event: NativeCodeEvent,
      row?: CodeRow,
    ) => NativeCodeEvent | undefined;
  };
}) {
  const id = props.id ?? "pierre",
    options = props.options ?? defaultOptions,
    theme = useCodeTheme(options),
    uiTheme = useUI().theme,
    native = useGpuixRequired();
  const revision = useSyncExternalStore(editor.subscribe, editor.getSnapshot),
    ref = useRef<PublicInstance | null>(null);
  const [collapsed, setCollapsed] = useState(options.collapsed ?? false),
    [utility, setUtility] = useState<{ lineNumber: number; side: string }>();
  const inlineHeader =
    !collection &&
    options.stickyHeader === false &&
    !options.disableFileHeader &&
    !collapsed;
  const anchor = useRef<SelectedLineRange | null>(null);
  const [lineSelection, setLineSelection] = useState<SelectedLineRange | null>(
    null,
  );
  const [hovered, setHovered] = useState<{
    row: number;
    offset: number;
    side: string;
  }>();
  useLayoutEffect(() => {
    if (props.lineAnnotations) editor.setLineAnnotations(props.lineAnnotations);
  }, [editor, props.lineAnnotations]);
  useEffect(() => {
    setCollapsed(options.collapsed ?? false);
  }, [options.collapsed]);
  useLayoutEffect(
    () =>
      (collection?.attachFocus ?? editor.attachFocus.bind(editor))((focus) => {
        if (focus && ref.current) native.focusElement?.(ref.current.id);
        else if (!focus) native.blur?.();
      }),
    [editor, native, collection?.attachFocus],
  );
  useLayoutEffect(() => {
    props.onReady?.(editor);
  }, [editor]);
  useLayoutEffect(() => {
    if (!diff || diff.isPartial) {
      editor.cursorOptions.resolveRenderableLine = undefined;
      return;
    }
    const lines = [
      ...new Set(
        rows.flatMap((r) =>
          [r.left, r.right]
            .filter(
              (c) =>
                c?.side === "additions" &&
                (!collection || c.owner === collection.owner),
            )
            .map((c) => c!.number! - 1),
        ),
      ),
    ].sort((a, b) => a - b);
    editor.cursorOptions.resolveRenderableLine = (line, direction) => {
      let low = 0,
        high = lines.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (lines[middle] < line) low = middle + 1;
        else high = middle;
      }
      return direction === "down" || lines[low] === line
        ? lines[low]
        : lines[low - 1];
    };
  }, [rows, editor, diff?.isPartial, !!diff, collection?.owner]);
  const fontSize = options.fontSize ?? 13,
    fontFamily = options.fontFamily ?? "JetBrains Mono",
    lineHeight = options.lineHeight ?? 20;
  const gutter = useMemo(() => {
    const number = Math.max(
      1,
      String(
        Math.max(
          diff?.additionLines.length ?? editor.document.lineCount,
          diff?.deletionLines.length ?? 0,
        ),
      ).length,
    );
    const ch =
      native.measureTextWidths?.(fontFamily, fontSize, 400, ["0"])[0] ??
      fontSize * 0.6;
    return Math.max(
      (number + 3) * ch + 2,
      props.renderGutterUtility
        ? number * fontSize * 0.6 + 8 + lineHeight + 4
        : 0,
    );
  }, [
    native,
    fontFamily,
    fontSize,
    lineHeight,
    diff,
    editor.document.lineCount,
    !!props.renderGutterUtility,
  ]);
  const selections = editor.selections.map((s) => ({
    anchor: editor.document.offsetAt(s.direction === -1 ? s.end : s.start),
    head: editor.document.offsetAt(s.direction === -1 ? s.start : s.end),
    side: "additions",
  }));
  const syntax = useMemo(
    () => highlight(editor.getFile(), theme.name),
    [editor, editor.getText(), theme.name],
  );
  const bracketRanges =
    editor.options.matchBrackets !== false &&
    editor.selections.length &&
    props.editor
      ? findBracketMatchRanges(
          editor.document,
          {
            getStringCommentRegexpRangesInLine: (line) =>
              (syntax[line] ?? [])
                .filter((t) => t.ignoredForBrackets)
                .map((t) => [t.start, t.end]),
          },
          getCaretPosition(editor.selections.at(-1)!),
        )
      : undefined;
  const decorations = [
    ...(editor.visiblePrediction?.edits ?? [])
      .filter(
        (edit) =>
          editor.document.offsetAt(edit.range.start) !==
          editor.document.offsetAt(edit.range.end),
      )
      .map((edit) => ({
        anchor: editor.document.offsetAt(edit.range.start),
        head: editor.document.offsetAt(edit.range.end),
        side: "additions",
        color: theme.delWord,
        kind: edit.newText ? "predictionReplace" : "predictionDelete",
      })),
    ...(bracketRanges ?? []).map((range) => ({
      anchor: editor.document.offsetAt(range.start),
      head: editor.document.offsetAt(range.end),
      side: "additions",
      color: alpha(theme.foreground, 0.12),
      kind: "bracket",
    })),
    ...(editor.search.mode ? editor.search.matches : []).map(
      ([anchor, head], i) => ({
        anchor,
        head,
        side: "additions",
        color: i === editor.search.index ? "#f5b94c88" : "#f5b94c33",
      }),
    ),
    ...editor.markers.map((m) => ({
      kind: "marker",
      anchor: editor.document.offsetAt(m.start),
      head: editor.document.offsetAt(m.end),
      side: "additions",
      color: markerColor(theme, m.severity),
    })),
    ...editor.carets.flatMap((c) => [
      {
        anchor: editor.document.offsetAt(c.anchor),
        head: editor.document.offsetAt(c.focus),
        side: "additions",
        color: alpha(c.metadata.color, 0.2),
      },
      {
        anchor: editor.document.offsetAt(c.focus),
        head: editor.document.offsetAt(c.focus),
        side: "additions",
        color: c.metadata.color,
        label: c.metadata.label,
      },
    ]),
  ];
  const selected =
    props.selectedLines === undefined ? lineSelection : props.selectedLines;
  const { annotationNodes, visibleRows } = useMemo(() => {
    if (
      !inlineHeader &&
      !selected &&
      !hovered &&
      !props.renderSelectionAction &&
      (collection || !editor.lineAnnotations.length)
    )
      return { annotationNodes: collection?.slots ?? [], visibleRows: rows };
    const nodes: ReactNode[] = [...(collection?.slots ?? [])],
      result: CodeRow[] = [];
    const insert = (
      element: ReactNode,
      side: string,
      overlay = false,
      inset?: number,
      anchor?: string,
      width?: number,
      identity?: string,
      offset?: number,
    ) => {
      const slot = nodes.length;
      const key = identity ?? `annotation-${slot}`;
      nodes.push(
        <Part
          key={key}
          component="pierre"
          name={overlay ? "Overlay" : "Annotation"}
          id={`${id}/annotation/${slot}`}
          style={{
            ...column,
            padding: overlay ? 0 : 8,
            backgroundColor: overlay ? "#00000000" : theme.context,
            ...(overlay ? { alignItems: "flex-start" as const, width } : {}),
          }}
        >
          {element}
        </Part>,
      );
      result.push({
        id: key,
        kind: "annotation",
        height: 0,
        slot,
        slotSide: side,
        overlay,
        slotInset: inset,
        slotAnchor: anchor,
        slotWidth: width,
        slotOffset: offset,
      });
    };
    if (inlineHeader) {
      const slot = nodes.length;
      nodes.push(
        <Header
          key="header"
          id={id}
          file={file}
          editor={editor}
          theme={theme}
          props={props}
          collapsed={collapsed}
          toggle={() => setCollapsed(!collapsed)}
        />,
      );
      result.push({
        id: "file-header",
        kind: "header",
        slot,
        slotSide: "full",
        slotInset: 0,
        height: 44,
      });
    }
    const annotations = collection ? [] : editor.lineAnnotations;
    for (const annotation of annotations.filter((a) => a.lineNumber === 0))
      insert(
        props.renderAnnotation?.(annotation) ?? (
          <Label>{String(annotation.metadata ?? "")}</Label>
        ),
        "side" in annotation ? (annotation.side ?? "additions") : "additions",
        false,
        undefined,
        undefined,
        undefined,
        annotationKey(annotation, props),
      );
    const cross =
      selected?.endSide && selected.endSide !== selected.side
        ? [
            rows.findIndex((r) =>
              [r.left, r.right].some(
                (c) =>
                  c?.side === (selected.side ?? "additions") &&
                  c?.number === selected.start,
              ),
            ),
            rows.findIndex((r) =>
              [r.left, r.right].some(
                (c) =>
                  c?.side === selected.endSide && c?.number === selected.end,
              ),
            ),
          ]
        : undefined;
    for (let index = 0; index < rows.length; index++) {
      const item = rows[index];
      const selectCell = (cell: CodeRow["left"]) =>
        cell &&
        selected &&
        cell.number !== undefined &&
        (cross
          ? index >= Math.min(...cross) && index <= Math.max(...cross)
          : cell.number >= Math.min(selected.start, selected.end) &&
            cell.number <= Math.max(selected.start, selected.end) &&
            (selected.side === undefined || selected.side === cell.side))
          ? {
              ...cell,
              background: theme.selection,
              gutterBackground: theme.selection,
            }
          : cell;
      result.push(
        selected
          ? {
              ...item,
              left: selectCell(item.left),
              right: selectCell(item.right),
            }
          : item,
      );
      for (const annotation of annotations) {
        const side =
            "side" in annotation
              ? (annotation.side ?? "additions")
              : "additions",
          cell =
            side === "deletions"
              ? item.left
              : options.diffStyle !== "unified" && diff
                ? item.right
                : item.left;
        if (cell?.number === annotation.lineNumber && cell.side === side)
          insert(
            props.renderAnnotation?.(annotation) ?? (
              <Label size={13}>
                {typeof annotation.metadata === "string"
                  ? annotation.metadata
                  : JSON.stringify(annotation.metadata)}
              </Label>
            ),
            side,
            false,
            undefined,
            undefined,
            undefined,
            annotationKey(annotation, props),
          );
      }
      if (hovered?.row === index) {
        const cell =
          hovered.side === "deletions"
            ? item.left
            : diff && options.diffStyle !== "unified"
              ? item.right
              : item.left;
        if (cell?.number && props.renderGutterUtility)
          insert(
            props.renderGutterUtility({
              lineNumber: cell.number,
              side: cell.side,
              owner: item.owner,
            }),
            cell.side,
            true,
            0,
            item.id,
            lineHeight,
            "gutter-utility",
          );
        const marker =
          hovered.side !== "deletions"
            ? editor.markers.find(
                (m) =>
                  hovered.offset >= editor.document.offsetAt(m.start) &&
                  hovered.offset < editor.document.offsetAt(m.end),
              )
            : undefined;
        if (marker)
          insert(
            props.renderMarker?.(marker) ?? (
              <Part
                component="pierre"
                name="MarkerPopover"
                id={`${id}/marker-popover`}
                style={{
                  ...column,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 12,
                  paddingRight: 12,
                  width: "100%",
                  maxWidth: "100%",
                  borderRadius: 9,
                  boxShadow: [
                    {
                      color: "#00000026",
                      offsetX: 0,
                      offsetY: 4,
                      blurRadius: 8,
                      spreadRadius: 0,
                    },
                    {
                      color: "#00000026",
                      offsetX: 0,
                      offsetY: 6,
                      blurRadius: 18,
                      spreadRadius: 0,
                    },
                  ],
                  backgroundColor: markerColor(theme, marker.severity),
                }}
              >
                <Label
                  size={14}
                  style={{
                    lineHeight: 20,
                    color: markerContrast(markerColor(theme, marker.severity)),
                  }}
                >
                  {marker.message}
                </Label>
              </Part>
            ),
            hovered.side,
            true,
            undefined,
            undefined,
            Math.min(
              640,
              Math.max(
                180,
                Math.ceil(
                  native.measureTextWidths?.(uiTheme.font.sans, 14, 400, [
                    marker.message,
                  ])[0] ?? marker.message.length * 8,
                ) + 24,
              ),
            ),
            "marker-popover",
            editor.document.offsetAt(marker.start),
          );
      }
      const primary = editor.selections.at(-1);
      if (
        props.renderSelectionAction &&
        !editor.search.mode &&
        primary &&
        editor.document.offsetAt(primary.start) !==
          editor.document.offsetAt(primary.end)
      ) {
        const focus = getCaretPosition(primary),
          cell =
            diff && options.diffStyle !== "unified" ? item.right : item.left;
        if (cell?.side === "additions" && cell.number === focus.line + 1)
          insert(
            props.renderSelectionAction({
              editor,
              text: editor.document.getText(primary),
            }),
            "additions",
            true,
            undefined,
            undefined,
            undefined,
            "selection-action",
          );
      }
    }
    return { annotationNodes: nodes, visibleRows: result };
  }, [
    rows,
    collection?.slots,
    inlineHeader,
    editor.lineAnnotations,
    props.renderAnnotation,
    props.getAnnotationKey,
    props.renderMarker,
    props.renderSelectionAction,
    props.renderGutterUtility,
    options.diffStyle,
    diff,
    theme,
    id,
    selected,
    hovered,
    editor.markers,
    editor.search.mode,
    uiTheme.font.sans,
    props.renderSelectionAction ? revision : undefined,
  ]);
  const spec = useMemo(
    () => ({
      text: collection?.text ?? editor.getText(),
      oldText: collection?.oldText ?? diff?.deletionLines.join("") ?? "",
      rows: visibleRows,
      split: collection?.split ?? (!!diff && options.diffStyle !== "unified"),
      wrap: options.overflow === "wrap",
      readOnly:
        !!diff?.isPartial ||
        (!props.edit && !props.editor) ||
        editor.options.readOnly,
      lineNumbers: !options.disableLineNumbers,
      lineHoverHighlight: options.lineHoverHighlight ?? "disabled",
      hoverColors: Object.fromEntries(
        ["context", "addition", "deletion"].map((kind) => {
          const base =
            options.disableBackground || kind === "context"
              ? theme.background
              : kind === "addition"
                ? theme.addBackground
                : theme.delBackground;
          const gutter =
            options.disableBackground || kind === "context"
              ? theme.background
              : kind === "addition"
                ? theme.addGutter
                : theme.delGutter;
          const target =
            kind === "context"
              ? theme.mode === "dark"
                ? "#ffffff"
                : "#000000"
              : kind === "addition"
                ? theme.addition
                : theme.deletion;
          return [
            kind,
            [
              mix(base, target, theme.mode === "dark" ? 0.09 : 0.03),
              mix(gutter, target, theme.mode === "dark" ? 0.09 : 0.03),
            ],
          ];
        }),
      ),
      indicators: diff ? (options.diffIndicators ?? "bars") : "none",
      fontFamily,
      fontSize,
      lineHeight,
      tabSize: options.tabSize ?? 2,
      gutter,
      gutterUtilityWidth: props.renderGutterUtility ? lineHeight + 4 : 0,
      foreground: theme.foreground,
      background: theme.background,
      numberColor: theme.number,
      selectionColor: theme.selection,
      caretColor: theme.caret,
      separatorColor: theme.separator,
      annotationBackground: theme.context,
      separatorForeground: theme.number,
      addition: theme.addition,
      deletion: theme.deletion,
      buffer: theme.buffer,
      activeLine: props.edit || props.editor ? theme.activeLine : "#00000000",
    }),
    [
      visibleRows,
      collection?.text,
      collection?.oldText,
      collection?.split,
      editor.getText(),
      diff,
      options,
      fontFamily,
      fontSize,
      lineHeight,
      gutter,
      theme,
      props.edit,
      props.editor,
      editor.options.readOnly,
    ],
  );
  const bridge = useRef(new DocumentBridge()).current;
  const documentProps = bridge.update(spec);
  const documentBlob = useMemo(
    () => JSON.stringify(documentProps.spec),
    [documentProps.spec],
  );
  const patchBlob = useMemo(
    () =>
      JSON.stringify(
        documentProps.patch
          ? { chain: documentProps.patch.chain ?? [documentProps.patch] }
          : null,
      ),
    [documentProps.patch],
  );
  const view = {
    session: controllerId(editor),
    resetSessionScroll: !collection,
    focusRequest: editor.focusRequest,
    selections: selections.map((s) => ({
      ...s,
      anchor: s.anchor + (collection?.offset ?? 0),
      head: s.head + (collection?.offset ?? 0),
    })),
    decorations: decorations.map((s) => ({
      ...s,
      anchor: s.anchor + (collection?.offset ?? 0),
      head: s.head + (collection?.offset ?? 0),
    })),
    predictions: predictionGroups(
      editor.document,
      editor.visiblePrediction,
    ).map((p) => ({
      ...p,
      anchor: p.anchor + (collection?.offset ?? 0),
      head: p.head + (collection?.offset ?? 0),
    })),
    activeOwner: collection?.owner,
    revision,
    ack: editor.nativeSequence,
    reveal: editor.reveal,
    scrollRequest: editor.scrollRequest,
    scrollTop: editor.view.scrollTop ?? 0,
    scrollLeft: editor.view.scrollLeft ?? 0,
  };
  const event = (input: NativeCodeEvent) => {
    if (input.documentVersion) bridge.acknowledge(input.documentVersion);
    const event = collection
      ? collection.event(
          input,
          input.row === undefined ? undefined : visibleRows[input.row],
        )
      : input;
    if (!event) return;
    if (event.kind === "hover" && event.row === undefined) {
      setHovered(undefined);
      return;
    }
    if (event.kind === "hover" && event.row !== undefined) {
      const originalRow = rows.findIndex(
        (r) => r.id === visibleRows[event.row!]?.id,
      );
      const previous = hovered && rows[hovered.row];
      const previousCell =
        hovered?.side === "deletions"
          ? previous?.left
          : diff && options.diffStyle !== "unified"
            ? previous?.right
            : previous?.left;
      const next = visibleRows[event.row],
        cell =
          event.side === "deletions"
            ? next?.left
            : diff && options.diffStyle !== "unified"
              ? next?.right
              : next?.left;
      if (cell?.number && previousCell?.number !== cell.number) {
        if (previousCell?.number)
          props.onLineLeave?.({
            lineNumber: previousCell.number,
            side: previousCell.side,
          });
        props.onLineEnter?.({ lineNumber: cell.number, side: cell.side });
      }
      if (props.renderGutterUtility || editor.markers.length)
        setHovered({
          row: originalRow,
          offset: event.head ?? 0,
          side: event.side ?? "additions",
        });
      editor.handleNativeEvent(event);
      return;
    }
    editor.nativeSequence = event.seq ?? editor.nativeSequence;
    if (event.documentVersion !== undefined)
      bridge.acknowledge(event.documentVersion);
    if (event.kind === "action" && event.row !== undefined) {
      const r = visibleRows[event.row];
      if (r) onAction?.(event, r);
      return;
    }
    if (event.kind === "select" && event.row !== undefined) {
      const r = visibleRows[event.row],
        cell =
          event.side === "deletions" ? r.left : spec.split ? r.right : r.left;
      if (cell?.number) {
        const data = { lineNumber: cell.number, side: cell.side };
        props.onLineClick?.(data);
        const offset = (event.head ?? 0) - (cell.start ?? 0),
          token = cell.tokens.find((t) => offset >= t.start && offset < t.end);
        if (token)
          props.onTokenClick?.({
            ...data,
            text: cell.text.slice(token.start, token.end),
            start: token.start,
            end: token.end,
          });
        setUtility(data);
        if (
          event.action === "line" &&
          (props.enableLineSelection || props.onLineSelect)
        ) {
          const first = event.shift ? anchor.current : null;
          const range = {
            start: first?.start ?? cell.number,
            end: cell.number,
            side: first?.side ?? cell.side,
            endSide:
              first?.side && first.side !== cell.side ? cell.side : undefined,
          } as SelectedLineRange;
          anchor.current = range;
          setLineSelection(range);
          props.onLineSelect?.(range);
          if (range.endSide) return;
        }
      }
    }
    editor.handleNativeEvent(event);
  };
  return (
    <Part
      component="pierre"
      name="Root"
      id={id}
      data={{ file, options }}
      style={{
        ...column,
        width: "100%",
        height: props.height ?? "100%",
        minHeight: 0,
        minWidth: 0,
        backgroundColor: theme.background,
        overflow: "hidden",
      }}
    >
      {!inlineHeader && (
        <Header
          id={id}
          file={file}
          theme={theme}
          props={props}
          editor={editor}
          collapsed={collapsed}
          toggle={() => setCollapsed(!collapsed)}
        />
      )}
      {!collapsed && (
        <>
          {editor.search.mode && (
            <Search
              editor={editor}
              id={id}
              onRequestEdit={props.onRequestEdit}
            />
          )}
          <Part
            ref={ref}
            component="pierre"
            name="Viewport"
            id={`${id}/viewport`}
            as="pierre-viewport"
            tabIndex={0}
            aria-label={`${props.edit ? "Edit" : "View"} ${file.name}`}
            nativeProps={{ spec: documentBlob, patch: patchBlob, view }}
            onChange={(e) => {
              if (e.value) event(JSON.parse(e.value));
            }}
            style={{
              width: "100%",
              flexGrow: 1,
              minHeight: 0,
              minWidth: 0,
              height: "100%",
              marginTop: options.disableFileHeader ? 8 : 0,
              marginBottom: 8,
            }}
          >
            {annotationNodes}
          </Part>
          {editor.clipboardError && (
            <Label tone="red">{editor.clipboardError}</Label>
          )}
          {editor.predictionError && (
            <Label tone="red">{editor.predictionError}</Label>
          )}
        </>
      )}
    </Part>
  );
}
function useEditor(
  props: CommonCodeProps,
  file: FileContents,
  type: "file" | "file-diff",
): AnyEditor {
  const callbacks = useRef(props);
  callbacks.current = props;
  const editor = useMemo(
    () =>
      props.editor ??
      new Editor(type, file, {
        readOnly: !props.edit,
        editStateKey: props.editStateKey,
        clipboard,
        onChange: ({ file }) => callbacks.current.onEditChange?.(file),
        onFocus: (editor) => callbacks.current.onFocus?.(editor),
        onBlur: (editor) => callbacks.current.onBlur?.(editor),
        onComplete: ({ file }) => callbacks.current.onEditComplete?.(file),
      }),
    [props.editor, type, props.editStateKey],
  );
  useEffect(
    () => () => {
      if (!props.editor) editor.dispose();
    },
    [editor, props.editor],
  );
  useLayoutEffect(() => {
    if (!props.editor && editor.options.readOnly !== !props.edit)
      editor.setOptions({ ...editor.options, readOnly: !props.edit });
  }, [editor, props.editor, props.edit]);
  const source = useRef({ name: file.name, contents: file.contents });
  useLayoutEffect(() => {
    if (
      !props.editor &&
      (source.current.contents !== file.contents ||
        source.current.name !== file.name)
    )
      editor.replaceDocument(file);
    source.current = { name: file.name, contents: file.contents };
  }, [editor, props.editor, file.contents, file.name]);
  return editor;
}
export function File(props: FileProps) {
  const ansi = props.file.lang === "ansi" && !props.edit && !props.editor;
  const documentFile = useMemo(
    () =>
      ansi
        ? {
            ...props.file,
            contents: stripVTControlCharacters(props.file.contents),
            lang: "text",
          }
        : props.file,
    [props.file, ansi],
  );
  const editor = useEditor(props, documentFile, "file");
  useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const theme = useCodeTheme(props.options);
  const file = editor.getFile();
  const rows = useMemo(
    () =>
      fileRows(
        ansi ? props.file : file,
        theme,
        !!(props.edit || props.editor),
        props.options,
      ),
    [
      file.contents,
      file.name,
      file.lang,
      ansi,
      props.file,
      theme,
      props.edit,
      props.editor,
      props.options,
    ],
  );
  return <Surface props={props} file={file} editor={editor} rows={rows} />;
}
export function FileDiff(props: FileDiffProps) {
  const original = useMemo(
    () =>
      props.fileDiff ??
      parseDiffFromFile(
        props.oldFile ?? null,
        props.newFile ?? null,
        props.options?.parseDiffOptions,
      ),
    [
      props.fileDiff,
      props.oldFile,
      props.newFile,
      props.options?.parseDiffOptions,
    ],
  );
  const file = useMemo(
    () => ({
      name: original.name,
      contents: original.additionLines.join(""),
      lang: original.lang,
    }),
    [original],
  );
  const editor = useEditor(props, file, "file-diff");
  const revision = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [resolved, setResolved] = useState<FileDiffMetadata | undefined>(() => {
      const snapshot = editor.retainedDiff;
      return snapshot
        ? parseDiffFromFile(
            snapshot.oldFile
              ? {
                  name: snapshot.oldFile.name,
                  contents: snapshot.oldFile.lines.join(""),
                }
              : null,
            editor.getFile(),
          )
        : undefined;
    }),
    [expanded, setExpanded] = useState<Map<number, HunkExpansionRegion>>(
      new Map(),
    ),
    [actionHunk, setActionHunk] = useState<number>(),
    [error, setError] = useState("");
  const [hydrated, setHydrated] = useState<FileDiffMetadata>();
  const hydrationGeneration = useRef(0);
  useLayoutEffect(
    () => () => {
      hydrationGeneration.current++;
    },
    [original],
  );
  const priorOriginal = useRef(original);
  useLayoutEffect(() => {
    if (priorOriginal.current === original) return;
    priorOriginal.current = original;
    setResolved(undefined);
    setExpanded(new Map());
    setHydrated(undefined);
  }, [original]);
  const diff = useMemo(() => {
    const base = resolved ?? hydrated ?? original;
    if (!base.isPartial && editor.getText() !== base.additionLines.join(""))
      return parseDiffFromFile(
        {
          name: base.prevName ?? base.name,
          contents: base.deletionLines.join(""),
        },
        editor.getFile(),
        props.options?.parseDiffOptions,
      );
    return base;
  }, [original, resolved, hydrated, editor, revision]);
  useLayoutEffect(() => {
    if (!diff.isPartial)
      editor.retainDiff({
        oldFile: {
          name: diff.prevName ?? diff.name,
          lines: diff.deletionLines,
        },
        type: diff.type,
        hunks: diff.hunks,
      });
  }, [diff, editor]);
  const theme = useCodeTheme(props.options);
  const rows = useMemo(
    () =>
      diffRows(
        diff,
        theme,
        props.options,
        props.options?.expandUnchanged ? true : expanded,
      ),
    [diff, theme, props.options, expanded],
  );
  useLayoutEffect(() => {
    if (!editor.reveal || diff.isPartial) return;
    const line = getCaretPosition(editor.selections.at(-1)!).line + 1;
    if (
      !rows.some((r) =>
        [r.left, r.right].some(
          (c) => c?.side === "additions" && c.number === line,
        ),
      )
    )
      setExpanded((current) => expandToLine(diff, current, line));
  }, [editor, editor.reveal, diff.isPartial]);
  const resolve = (action: "accept" | "reject") => {
    if (actionHunk === undefined) return;
    const next = diffAcceptRejectHunk(diff, actionHunk, action);
    setResolved(next);
    if (editor.getText() !== next.additionLines.join(""))
      editor.replaceDocument({
        name: next.name,
        contents: next.additionLines.join(""),
        lang: next.lang,
      });
    props.onHunkAction?.(actionHunk, action, next);
    props.onDiffChange?.(next);
    setActionHunk(undefined);
  };
  const onAction = async (e: NativeCodeEvent, r: CodeRow) => {
    if (r.kind === "actions") {
      setActionHunk(r.hunkIndex);
      return;
    }
    if (r.kind !== "separator") return;
    if (diff.isPartial && props.options?.loadDiffFiles) {
      const generation = ++hydrationGeneration.current;
      try {
        const files = await props.options.loadDiffFiles(diff);
        if (files && generation === hydrationGeneration.current) {
          const full = hydratePartialDiff("clone", diff, files);
          editor.replaceDocument({
            name: full.name,
            contents: full.additionLines.join(""),
            lang: full.lang,
          });
          setHydrated(full);
        }
      } catch (e) {
        if (generation === hydrationGeneration.current) setError(String(e));
      }
      return;
    }
    const h = r.hunkIndex ?? 0,
      n = props.options?.expansionLineCount ?? 100;
    setExpanded((current) => {
      const next = new Map(current),
        old = next.get(h) ?? { fromStart: 0, fromEnd: 0 };
      next.set(h, { fromStart: old.fromStart + n, fromEnd: old.fromEnd + n });
      return next;
    });
  };
  return (
    <Box
      style={{
        ...column,
        width: "100%",
        height: props.height ?? "100%",
        minHeight: 0,
      }}
    >
      {actionHunk !== undefined && (
        <Part
          component="pierre"
          name="HunkActions"
          id={`${props.id ?? "pierre"}/hunk-actions`}
          style={{ ...row, gap: 8, padding: 8 }}
        >
          <Label size={12}>{`Change ${actionHunk + 1}`}</Label>
          <Control
            id={`${props.id ?? "pierre"}/accept`}
            label="Accept change"
            onPress={() => resolve("accept")}
          />
          <Control
            id={`${props.id ?? "pierre"}/reject`}
            label="Reject change"
            onPress={() => resolve("reject")}
          />
          <Control
            id={`${props.id ?? "pierre"}/cancel-hunk`}
            label="Close"
            onPress={() => setActionHunk(undefined)}
          />
        </Part>
      )}
      {error && <Label tone="red">{error}</Label>}
      <Surface
        props={{ ...props, edit: props.edit && !diff.isPartial }}
        file={diff}
        diff={diff}
        editor={editor}
        rows={rows}
        onAction={(e, r) => void onAction(e, r)}
      />
    </Box>
  );
}
export function PatchDiff({
  patch,
  ...props
}: CommonCodeProps & { patch: string }) {
  const files = useMemo(
    () => parsePatchFiles(patch).flatMap((p) => p.files),
    [patch],
  );
  return <MultiFileDiff {...props} files={files} />;
}
export function TabbedFileDiff({
  files,
  ...props
}: CommonCodeProps & { files: FileDiffMetadata[] }) {
  const [selected, setSelected] = useState(0);
  const file = files[Math.min(selected, files.length - 1)];
  return (
    <Box
      style={{
        ...column,
        width: "100%",
        height: props.height ?? "100%",
        minHeight: 0,
      }}
    >
      <Part
        component="pierre"
        name="FileList"
        id={`${props.id ?? "pierre"}/files`}
        role="tablist"
        style={{ ...row, flexShrink: 0, gap: 4, padding: 4 }}
      >
        {files.map((f, i) => (
          <Control
            key={`${f.name}-${i}`}
            id={`${props.id ?? "pierre"}/tab/${i}`}
            label={f.name}
            onPress={() => setSelected(i)}
          />
        ))}
      </Part>
      {file ? (
        <FileDiff key={file.name} {...props} fileDiff={file} />
      ) : (
        <Label>No files</Label>
      )}
    </Box>
  );
}
export function UnresolvedFile({
  file,
  onResolve,
  ...props
}: FileProps & { onResolve?: (file: FileContents) => void }) {
  const [current, setCurrent] = useState(file);
  useLayoutEffect(() => setCurrent(file), [file]);
  const parsed = useMemo(
    () => parseMergeConflictDiffFromFile(current),
    [current],
  );
  const accept = (index: number, type: "current" | "incoming" | "both") => {
    const action = parsed.actions[index];
    if (!action) return;
    const next = resolveConflict(parsed.fileDiff, action, type);
    const f = { ...current, contents: next.additionLines.join("") };
    setCurrent(f);
    onResolve?.(f);
  };
  return (
    <Box
      style={{
        ...column,
        height: props.height ?? "100%",
        width: "100%",
        minHeight: 0,
      }}
    >
      {parsed.actions.map(
        (a, i) =>
          a && (
            <Part
              key={i}
              component="pierre"
              name="HunkActions"
              id={`${props.id ?? "pierre"}/conflict/${i}`}
              style={{ ...row, gap: 8, padding: 8 }}
            >
              <Label size={12}>{`Conflict ${i + 1}`}</Label>
              {(["current", "incoming", "both"] as const).map((type) => (
                <Control
                  key={type}
                  id={`${props.id ?? "pierre"}/conflict/${i}/${type}`}
                  label={`Accept ${type}`}
                  onPress={() => accept(i, type)}
                />
              ))}
            </Part>
          ),
      )}
      <FileDiff {...props} fileDiff={parsed.fileDiff} />
    </Box>
  );
}
export type CodeViewItem = {
  id: string;
  type?: "file" | "diff";
  edit?: boolean;
  collapsed?: boolean;
  version?: number;
  annotations?: (LineAnnotation<any> | DiffLineAnnotation<any>)[];
  file?: FileContents;
  oldFile?: FileContents | null;
  newFile?: FileContents | null;
  fileDiff?: FileDiffMetadata;
  editor?: AnyEditor;
};
export function MultiFileDiff({
  files,
  ...props
}: CommonCodeProps & { files: FileDiffMetadata[] }) {
  return (
    <CodeView
      {...props}
      items={files.map((fileDiff, index) => ({
        id: `${fileDiff.name}-${index}`,
        fileDiff,
      }))}
    />
  );
}
/** One GPUI viewport supplies continuous scrolling and shapes only visible file rows. */
export function CodeView({
  items,
  onItemEditChange,
  onItemDiffChange,
  ...props
}: CommonCodeProps & {
  items: CodeViewItem[];
  onItemEditChange?: (id: string, file: FileContents) => void;
  onItemDiffChange?: (id: string, diff: FileDiffMetadata) => void;
}) {
  const callbacks = useRef({ onItemEditChange, onItemDiffChange });
  callbacks.current = { onItemEditChange, onItemDiffChange };
  const [overrides, setOverrides] = useState(
      new Map<string, { source: unknown; diff: FileDiffMetadata }>(),
    ),
    [error, setError] = useState<string>();
  const sessions = useRef(
    new Map<string, { editor: AnyEditor; source: string; owned: boolean }>(),
  ).current;
  const [active, setActive] = useState(items[0]?.id ?? ""),
    [revision, update] = useState(0),
    [collapsed, setCollapsed] = useState(
      new Set(items.filter((i) => i.collapsed).map((i) => i.id)),
    ),
    [expanded, setExpanded] = useState(new Set<string>());
  const options = props.options ?? defaultOptions,
    theme = useCodeTheme(options),
    split = items.some((i) => !i.file) && options.diffStyle !== "unified";
  const prepared = items.map((item) => {
    const source =
      item.fileDiff ??
      `${item.oldFile?.contents ?? ""}\0${item.newFile?.contents ?? ""}`;
    const override = overrides.get(item.id);
    const diff =
      override?.source === source
        ? override.diff
        : item.file
          ? undefined
          : (item.fileDiff ??
            parseDiffFromFile(
              item.oldFile ?? null,
              item.newFile ?? null,
              options.parseDiffOptions,
            ));
    const file = item.file ?? {
      name: diff!.name,
      contents: diff!.additionLines.join(""),
      lang: diff!.lang,
    };
    let session = sessions.get(item.id);
    if (!session) {
      session = {
        editor:
          item.editor ??
          new Editor(item.file ? "file" : "file-diff", file, {
            readOnly: !(props.edit || item.edit),
            clipboard,
            onChange: ({ file }) =>
              callbacks.current.onItemEditChange?.(item.id, file),
          }),
        source: file.contents,
        owned: !item.editor,
      };
      sessions.set(item.id, session);
    }
    const activeEditor = item.editor ?? session.editor;
    const pendingFile =
      !item.editor && session.source !== file.contents ? file : undefined;
    const current =
      !pendingFile &&
      diff &&
      !diff.isPartial &&
      activeEditor.getText() !== file.contents
        ? parseDiffFromFile(
            {
              name: diff.prevName ?? diff.name,
              contents: diff.deletionLines.join(""),
            },
            activeEditor.getFile(),
            options.parseDiffOptions,
          )
        : diff;
    return { item, editor: activeEditor, diff: current, source, pendingFile };
  });
  useLayoutEffect(() => {
    for (const p of prepared) {
      if (p.pendingFile) {
        sessions.get(p.item.id)!.source = p.pendingFile.contents;
        p.editor.replaceDocument(p.pendingFile);
        update((n) => n + 1);
      }
      const session = sessions.get(p.item.id)!;
      if (session.editor !== p.editor) {
        if (session.owned) session.editor.dispose();
        session.editor = p.editor;
        session.owned = false;
      }
      if (
        session.owned &&
        p.editor.options.readOnly !== !(props.edit || p.item.edit)
      )
        p.editor.setOptions({
          ...p.editor.options,
          readOnly: !(props.edit || p.item.edit),
        });
    }
  }, [items, overrides, props.edit]);
  const ids = items.map((i) => i.id).join("\0"),
    subscriptions = prepared.map((p) => controllerId(p.editor)).join(",");
  useLayoutEffect(() => {
    const dispose = prepared.map((p) =>
      p.editor.subscribe(() => update((n) => n + 1)),
    );
    for (const [id, session] of sessions)
      if (!items.some((i) => i.id === id)) {
        if (session.owned) session.editor.dispose();
        sessions.delete(id);
      }
    return () => dispose.forEach((fn) => fn());
  }, [ids, subscriptions]);
  useEffect(
    () => () => {
      for (const session of sessions.values())
        if (session.owned) session.editor.dispose();
    },
    [],
  );
  const nativeFocus = useRef<((value: boolean) => void) | undefined>(undefined);
  const pendingFocus = useRef<string | undefined>(undefined);
  const attachFocus = useCallback((focus: (value: boolean) => void) => {
    nativeFocus.current = focus;
    return () => {
      if (nativeFocus.current === focus) nativeFocus.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const cleanup = prepared.map((p) =>
      p.editor.attachFocus((focus) => {
        if (!focus) {
          if (pendingFocus.current === p.item.id)
            pendingFocus.current = undefined;
          nativeFocus.current?.(false);
          return;
        }
        pendingFocus.current = p.item.id;
        setActive(p.item.id);
        update((n) => n + 1);
      }),
    );
    return () => cleanup.forEach((dispose) => dispose());
  }, [ids, subscriptions]);
  const selected = prepared.find((p) => p.item.id === active) ?? prepared[0];
  // Focus after Surface commits the selected document and attaches its native handle.
  // No timer is needed, and an inactive item's Edit button can use editor.focus().
  useLayoutEffect(() => {
    if (pendingFocus.current === selected?.item.id && nativeFocus.current) {
      pendingFocus.current = undefined;
      nativeFocus.current(true);
    }
  });
  const emptyEditor = useMemo(
    () =>
      new Editor("file", { name: "Files", contents: "" }, { readOnly: true }),
    [],
  );
  useEffect(() => () => emptyEditor.dispose(), [emptyEditor]);
  const resolveItem = (
    id: string,
    index: number,
    action: "accept" | "reject",
  ) => {
    const target = prepared.find((p) => p.item.id === id);
    if (!target?.diff) return;
    const next = diffAcceptRejectHunk(target.diff, index, action);
    if (target.editor.getText() !== next.additionLines.join(""))
      target.editor.replaceDocument({
        name: next.name,
        contents: next.additionLines.join(""),
        lang: next.lang,
      });
    setOverrides((v) =>
      new Map(v).set(id, { source: target.source, diff: next }),
    );
    callbacks.current.onItemDiffChange?.(id, next);
  };
  const data = useMemo(() => {
    let text = "",
      oldText = "";
    const rows: CodeRow[] = [],
      slots: ReactNode[] = [],
      offsets = new Map<string, { new: number; old: number }>();
    for (const p of prepared) {
      const offset = { new: text.length, old: oldText.length };
      offsets.set(p.item.id, offset);
      text += p.editor.getText() + "\n";
      oldText += (p.diff?.deletionLines.join("") ?? "") + "\n";
      const slot = slots.length;
      slots.push(
        <Header
          key={p.item.id}
          id={p.item.id}
          file={p.diff ?? p.editor.getFile()}
          editor={p.editor}
          theme={theme}
          props={{
            ...props,
            options: { ...options, disableFileHeader: false },
          }}
          collapsed={collapsed.has(p.item.id)}
          toggle={() =>
            setCollapsed((v) => {
              const next = new Set(v);
              if (next.has(p.item.id)) next.delete(p.item.id);
              else next.add(p.item.id);
              return next;
            })
          }
        />,
      );
      rows.push({
        id: `${p.item.id}/header`,
        kind: "header",
        slot,
        slotSide: "full",
        slotInset: 0,
        height: 44,
        sticky: options.stickyHeader !== false,
        owner: p.item.id,
      });
      if (collapsed.has(p.item.id)) continue;
      const content = p.diff
        ? diffRows(
            p.diff,
            theme,
            { ...options, diffStyle: split ? "split" : "unified" },
            expanded.has(p.item.id) || options.expandUnchanged
              ? true
              : undefined,
          )
        : fileRows(
            p.editor.getFile(),
            theme,
            !!props.edit || !!p.item.edit || !!p.item.editor,
            options,
          );
      const annotations = p.item.annotations ?? p.editor.lineAnnotations;
      const annotate = (a: LineAnnotation<any> | DiffLineAnnotation<any>) => {
        const slot = slots.length;
        slots.push(
          <Part
            key={`${p.item.id}/${annotationKey(a, props)}`}
            id={`${p.item.id}/annotation/${slot}`}
            component="pierre"
            name="Annotation"
            style={{ ...column, padding: 8, backgroundColor: theme.context }}
          >
            {props.renderAnnotation?.(a) ?? (
              <Label>{String(a.metadata ?? "")}</Label>
            )}
          </Part>,
        );
        rows.push({
          id: `${p.item.id}/annotation/${slot}`,
          owner: p.item.id,
          slot,
          slotSide: "side" in a ? a.side : "additions",
          kind: "annotation",
        });
      };
      for (const a of annotations) if (a.lineNumber === 0) annotate(a);
      for (const row of content) {
        if (row.kind === "actions") {
          const slot = slots.length;
          slots.push(
            <Part
              key={`${p.item.id}/hunk/${row.hunkIndex}`}
              id={`${p.item.id}/hunk/${row.hunkIndex}`}
              component="pierre"
              name="HunkActions"
              style={{
                ...rowStyle,
                gap: 8,
                padding: 6,
                backgroundColor: theme.context,
              }}
            >
              {(["accept", "reject"] as const).map((action) => (
                <Control
                  key={action}
                  id={`${p.item.id}/hunk/${row.hunkIndex}/${action}`}
                  label={
                    action === "accept" ? "Accept change" : "Reject change"
                  }
                  onPress={() => resolveItem(p.item.id, row.hunkIndex!, action)}
                />
              ))}
            </Part>,
          );
          rows.push({
            id: `${p.item.id}/${row.id}`,
            owner: p.item.id,
            kind: "actions",
            slot,
            slotSide: "full",
            slotInset: 0,
          });
          continue;
        }
        const map = (cell: CodeRow["left"]) =>
          cell
            ? {
                ...cell,
                owner: p.item.id,
                start:
                  cell.start === undefined
                    ? undefined
                    : cell.start +
                      offset[cell.side === "deletions" ? "old" : "new"],
              }
            : undefined;
        rows.push({
          ...row,
          id: `${p.item.id}/${row.id}`,
          owner: p.item.id,
          left: p.item.file && split ? undefined : map(row.left),
          right: p.item.file && split ? map(row.left) : map(row.right),
        });
        for (const a of annotations) {
          const side = "side" in a ? a.side : "additions";
          const cell =
            side === "deletions"
              ? row.left
              : p.diff && split
                ? row.right
                : row.left;
          if (cell?.side === side && cell.number === a.lineNumber) annotate(a);
        }
      }
    }
    return { text, oldText, rows, slots, offsets };
  }, [items, revision, options, collapsed, expanded, overrides]);
  const offset = data.offsets.get(selected?.item.id ?? "") ?? {
    new: 0,
    old: 0,
  };
  const event = (
    event: NativeCodeEvent,
    row?: CodeRow,
  ): NativeCodeEvent | undefined => {
    const target = prepared.find((p) => p.item.id === row?.owner) ?? selected;
    if (!target) return;
    if (event.kind === "action" && row?.kind === "separator") {
      if (target.diff?.isPartial && options.loadDiffFiles) {
        const partial = target.diff;
        void options
          .loadDiffFiles(partial)
          .then((files) => {
            if (!files) return;
            setOverrides((v) =>
              new Map(v).set(target.item.id, {
                source: target.source,
                diff: hydratePartialDiff("clone", partial, files),
              }),
            );
            setExpanded((v) => new Set([...v, target.item.id]));
          })
          .catch((e) => setError(String(e)));
        return;
      }
      setExpanded((v) => new Set([...v, target.item.id]));
      return;
    }
    if (event.kind === "select" && target.item.id !== active)
      setActive(target.item.id);
    const at = data.offsets.get(target.item.id)!;
    const local = (n: number) =>
      Math.max(0, Math.min(target.editor.getText().length, n - at.new));
    const mapped = {
      ...event,
      anchor: event.anchor === undefined ? undefined : local(event.anchor),
      head: event.head === undefined ? undefined : local(event.head),
      ranges: event.ranges?.map(
        ([a, b]) => [local(a), local(b)] as [number, number],
      ),
    };
    if (target !== selected && event.kind === "select") {
      target.editor.handleNativeEvent(mapped);
      return;
    }
    return mapped;
  };
  return (
    <Box style={{ ...column, height: props.height ?? "100%", minHeight: 0 }}>
      {error && <Label tone="red">{error}</Label>}
      <Surface
        props={{
          ...props,
          editor:
            props.edit || selected?.item.edit || selected?.item.editor
              ? selected?.editor
              : undefined,
          options: { ...options, disableFileHeader: true },
        }}
        file={{ name: "Files", contents: data.text }}
        editor={selected?.editor ?? emptyEditor}
        rows={data.rows}
        diff={selected?.diff}
        collection={{
          ...data,
          offset: offset.new,
          oldOffset: offset.old,
          owner: selected?.item.id ?? "",
          split,
          attachFocus,
          event,
        }}
      />
    </Box>
  );
}

export type FileStreamProps = FileProps & {
  stream?: ReadableStream<string>;
  follow?: boolean;
  onStreamWrite?: (text: string) => void;
  onStreamClose?: () => void;
  onStreamAbort?: (reason: unknown) => void;
};
export function FileStream({
  stream,
  follow = false,
  onStreamWrite,
  onStreamClose,
  onStreamAbort,
  ...props
}: FileStreamProps) {
  const editor = useMemo(
    () => new Editor("file", props.file, { readOnly: true }),
    [props.file.name],
  );
  const callbacks = useRef({
    follow,
    onStreamWrite,
    onStreamClose,
    onStreamAbort,
  });
  callbacks.current = { follow, onStreamWrite, onStreamClose, onStreamAbort };
  const [error, setError] = useState<string>();
  useEffect(() => () => editor.dispose(), [editor]);
  useEffect(() => {
    if (!stream) return;
    setError(undefined);
    const reader = stream.getReader();
    let cancelled = false;
    void (async () => {
      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          const at = editor.document.positionAt(editor.getText().length);
          const change = editor.document.applyEdits(
            [{ range: { start: at, end: at }, newText: value }],
            false,
          );
          if (change) {
            update((n) => n + 1);
            callbacks.current.onStreamWrite?.(value);
            if (callbacks.current.follow)
              editor.setViewState({
                view: { scrollTop: Number.MAX_SAFE_INTEGER, scrollLeft: 0 },
              });
          }
        }
        if (!cancelled) callbacks.current.onStreamClose?.();
      } catch (error) {
        if (!cancelled) {
          setError(String(error));
          callbacks.current.onStreamAbort?.(error);
        }
      } finally {
        reader.releaseLock();
      }
    })();
    return () => {
      cancelled = true;
      void reader.cancel().catch(() => {});
    };
  }, [stream, editor]);
  const [, update] = useState(0);
  return (
    <Box style={{ ...column, height: props.height ?? "100%", minHeight: 0 }}>
      {error && (
        <Part
          id={`${props.id ?? "pierre"}/error`}
          component="pierre"
          name="Error"
          role="alert"
        >
          <Label tone="red">{error}</Label>
        </Part>
      )}
      <File {...props} file={editor.getFile()} editor={editor} />
    </Box>
  );
}
