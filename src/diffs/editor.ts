import { isMac } from "../platform";
import { systemClipboard } from "./clipboard";
import { validatePrediction } from "./prediction";
import {
  EditStateManager,
  type ManagedEditSession,
} from "../../vendor/pierre/src/editor/EditStateManager";
import { getFiletypeFromFileName } from "../../vendor/pierre/src/utils/getFiletypeFromFileName";
import {
  TextDocument,
  type TextDocumentChange,
} from "../../vendor/pierre/src/editor/textDocument";
import { EditStack } from "../../vendor/pierre/src/editor/editStack";
import {
  resolveEditorCommandFromKeyboardEvent,
  resolveFindAgainShortcut,
  type EditorCommand,
  type EditorKeymap,
} from "../../vendor/pierre/src/editor/command";
import { isMoveCursorShortcut } from "../../vendor/pierre/src/editor/platform";
import * as selection from "../../vendor/pierre/src/editor/selection";
import { applyDocumentChangeToLineAnnotations } from "../../vendor/pierre/src/editor/lineAnnotations";
import {
  resolveCommentConfig,
  resolveLineCommentEdits,
  resolveBlockCommentEdits,
  type LanguageConfigMap,
} from "../../vendor/pierre/src/editor/languages";
import { buildSearchReplacementText } from "../../vendor/pierre/src/editor/pieceTable";
import {
  buildEditPredictionRequest,
  matchesEditPredictionPattern,
  recordEditPrediction,
  type EditPredictProvider,
  type EditPredictResponse,
  type EditPredictionHistoryRecord,
} from "../../vendor/pierre/src/editor/editPrediction";
import { getTextDocumentChangeTransaction } from "../../vendor/pierre/src/editor/textDocumentChangeTransaction";
import type {
  EditorType,
  EditorLineAnnotation,
  EditorSelection,
  Position,
  TextEdit,
  ResolvedTextEdit,
  EditorViewState,
  EditHistoryState,
} from "../../vendor/pierre/src/editor/types";
import type { SearchParams } from "../../vendor/pierre/src/editor/searchPanel";
import type { FileContents } from "./core";
const {
  isCollapsedSelection,
  expandCollapsedSelectionToWord,
  findNextMatch,
  getCaretPosition,
  DirectionNone,
  DirectionForward,
  resolveIndentEdits,
  getDocumentFullSelection,
  getDocumentBoundarySelection,
  extendSelections,
  remapSelectionsAfterEdits,
  getSelectedLineBlocks,
  shiftSelectionLines,
  applyTextReplaceToSelections,
  applyTextChangeToSelections,
  applyDeleteCharacterToSelections,
} = selection;
export type Marker = {
  start: Position;
  end: Position;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
};
export type RemoteCaret<T = unknown> = {
  anchor: Position;
  focus: Position;
  metadata: T & { color: string; label?: string };
};
export interface NativeEditorOptions<
  EType extends EditorType = EditorType,
  LAnnotation = unknown,
> {
  historyMaxEntries?: number;
  editStateKey?: string;
  matchBrackets?: boolean;
  enabledSelectionAction?: boolean;
  tabSize?: number;
  readOnly?: boolean;
  keymap?: EditorKeymap;
  autoSurround?: selection.AutoSurround;
  languageCommentConfig?: LanguageConfigMap;
  initialState?: {
    document?: TextDocument<EType, LAnnotation>;
    selections?: EditorSelection[];
    history?: EditHistoryState<EType, LAnnotation>;
    view?: EditorViewState["view"];
  };
  editPrediction?: {
    provider: EditPredictProvider;
    mode?: "eager" | "subtle";
    include?: readonly (string | RegExp)[];
    exclude?: readonly (string | RegExp)[];
  };
  clipboard?: {
    readText(): string | Promise<string>;
    writeText(text: string): void | Promise<void>;
  };
  onFocus?: (editor: Editor<EType, LAnnotation>) => void;
  onBlur?: (editor: Editor<EType, LAnnotation>) => void;
  onChange?: (event: {
    changes: TextDocumentChange["changes"];
    file: FileContents;
    editor: Editor<EType, LAnnotation>;
    lineAnnotations: EditorLineAnnotation<EType, LAnnotation>[];
  }) => void;
  onComplete?: (event: {
    file: FileContents;
    originalFile: FileContents;
    editor: Editor<EType, LAnnotation>;
  }) => "accept" | "reject" | void;
}
export type NativeCodeEvent = {
  kind:
    | "key"
    | "insert"
    | "select"
    | "scroll"
    | "action"
    | "layout"
    | "hover"
    | "focus"
    | "blur";
  key?: string;
  text?: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  anchor?: number;
  head?: number;
  side?: "additions" | "deletions";
  addCaret?: boolean;
  clickCount?: number;
  row?: number;
  action?: string;
  scrollTop?: number;
  scrollLeft?: number;
  seq?: number;
  marked?: boolean;
  ranges?: [number, number][];
  softLines?: Record<number, number[]>;
  viewportLines?: number;
  documentVersion?: number;
  predictionRendered?: boolean;
};
let nextFocusRequest = 0;

/** The document and command model is independent of GPUI and can run in a worker or tests. */
export class Editor<EType extends EditorType = "file", LAnnotation = unknown> {
  #options: NativeEditorOptions<EType, LAnnotation>;
  #editSession: { document: TextDocument<EType, LAnnotation> };
  #selections: EditorSelection[];
  #lineAnnotations: EditorLineAnnotation<EType, LAnnotation>[] = [];
  #metrics: { tabSize: number };
  #listeners = new Set<() => void>();
  #revision = 0;
  #original: FileContents;
  #file: FileContents;
  #textCache?: {
    document: TextDocument<EType, LAnnotation>;
    version: number;
    text: string;
  };
  #predictionAbort?: AbortController;
  #predictionTimer?: ReturnType<typeof setTimeout>;
  #predictionHistory: EditPredictionHistoryRecord[] = [];
  #source: "user" | "prediction" = "user";
  #clipboardSelections?: { text: string; parts: string[] };
  #nativeFocus?: (focus: boolean) => void;
  #disposed = false;
  #managed?: ManagedEditSession<any, any>;
  readonly editorType: EType;
  markers: Marker[] = [];
  carets: RemoteCaret[] = [];
  prediction?: EditPredictResponse;
  predictionRevealed = false;
  predictionRendered = false;
  focused = false;
  get visiblePrediction() {
    return this.#options.editPrediction?.mode !== "subtle" ||
      this.predictionRevealed
      ? this.prediction
      : undefined;
  }
  predictionError?: string;
  clipboardError?: string;
  search: SearchParams & {
    mode?: "find" | "replace";
    matches: [number, number][];
    index: number;
    error?: string;
  } = {
    text: "",
    replaceText: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    matches: [],
    index: -1,
  };
  view: NonNullable<EditorViewState["view"]> = { scrollTop: 0, scrollLeft: 0 };
  nativeSequence = 0;
  focusRequest = 0;
  reveal = 0;
  scrollRequest = 0;
  cursorOptions: selection.CursorMoveOptions = {};
  constructor(
    editorType: EType,
    file: FileContents,
    options: NativeEditorOptions<EType, LAnnotation> = {},
  ) {
    this.editorType = editorType;
    this.#options = {
      ...options,
      clipboard: options.clipboard ?? systemClipboard,
    };
    this.#original = { ...file };
    this.#file = { ...file };
    const retained = options.editStateKey
      ? EditStateManager.activate<EType, LAnnotation, unknown>(
          editorType,
          options.editStateKey,
          this,
        )
      : undefined;
    this.#managed = retained;
    const initial: NativeEditorOptions<EType, LAnnotation>["initialState"] =
      options.initialState ??
      (retained?.document
        ? {
            document: retained.document,
            selections: retained.editor?.selections,
            view: retained.editor?.view,
          }
        : undefined);
    this.#editSession = {
      document:
        initial?.document ??
        new TextDocument<EType, LAnnotation>(
          file.name,
          file.contents,
          file.lang ?? getFiletypeFromFileName(file.name),
          0,
          initial?.history
            ? EditStack.fromState(initial.history)
            : new EditStack({ maxEntries: options.historyMaxEntries }),
        ),
    };
    this.#selections = initial?.selections ?? [
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        direction: 0,
      },
    ];
    this.#metrics = { tabSize: options.tabSize ?? 2 };
    this.view = initial?.view ?? this.view;
    if (this.#managed) {
      this.#managed.document = this.document;
      this.#managed.fileInfo = { name: file.name, lang: file.lang };
      this.#managed.editor = this.getViewState();
    }
  }
  get document() {
    return this.#editSession.document;
  }
  retainDiff(snapshot: {
    oldFile: { name: string; lines: string[] } | null;
    type: any;
    hunks: any[];
  }) {
    if (this.#managed && this.#managed.type === "file-diff")
      this.#managed.diffSession = snapshot;
  }
  get retainedDiff() {
    return this.#managed?.type === "file-diff"
      ? this.#managed.diffSession
      : undefined;
  }
  get options() {
    return this.#options;
  }
  get selections() {
    return this.#selections;
  }
  get lineAnnotations() {
    return this.#lineAnnotations;
  }
  get canUndo() {
    return this.document.canUndo;
  }
  get canRedo() {
    return this.document.canRedo;
  }
  get #isDiff() {
    return this.editorType === "file-diff";
  }
  getSnapshot = () => this.#revision;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #notify() {
    if (this.#disposed) return;
    if (this.#managed) {
      this.#managed.document = this.document;
      this.#managed.editor = this.getViewState();
    }
    this.#revision++;
    for (const fn of this.#listeners) fn();
  }
  getText() {
    const document = this.document;
    if (
      this.#textCache?.document !== document ||
      this.#textCache.version !== document.version
    )
      this.#textCache = {
        document,
        version: document.version,
        text: document.getText(),
      };
    return this.#textCache.text;
  }
  getFile(): FileContents {
    return { ...this.#file, contents: this.getText() };
  }
  getViewState(): EditorViewState {
    return {
      selections: structuredClone(this.#selections),
      view: { ...this.view },
    };
  }
  getEditState() {
    return {
      document: this.document,
      ...this.getViewState(),
      lineAnnotations: this.#lineAnnotations,
    };
  }
  setOptions(options: NativeEditorOptions<EType, LAnnotation>) {
    this.#options = {
      ...options,
      clipboard: options.clipboard ?? systemClipboard,
    };
    this.#metrics.tabSize = options.tabSize ?? 2;
    this.#notify();
  }
  setViewState(state: EditorViewState) {
    if (state.selections) this.setSelections(state.selections);
    if (state.view) {
      this.view = { ...state.view };
      this.scrollRequest++;
    }
    this.#notify();
  }
  setSelections(
    selections: (Omit<EditorSelection, "direction"> & {
      direction: EditorSelection["direction"] | "none" | "forward" | "backward";
    })[],
    user = false,
  ) {
    const normalized = selections.map((s) => {
      let start = this.document.normalizePosition(s.start),
        end = this.document.normalizePosition(s.end);
      let direction = (
        s.direction === "none"
          ? 0
          : s.direction === "backward"
            ? -1
            : s.direction === "forward"
              ? 1
              : s.direction
      ) as EditorSelection["direction"];
      if (selection.comparePosition(start, end) > 0) {
        [start, end] = [end, start];
        direction = -direction as EditorSelection["direction"];
      }
      return { start, end, direction };
    });
    this.#updateSelections(normalized);
    this.#scrollToPrimaryCaret();
  }
  setLineAnnotations(annotations: EditorLineAnnotation<EType, LAnnotation>[]) {
    this.#lineAnnotations = annotations;
    this.#notify();
  }
  setMarkers(markers: Marker[]) {
    this.markers = markers;
    this.#notify();
  }
  setCarets(carets: RemoteCaret[]) {
    this.carets = carets;
    this.#notify();
  }
  attachFocus(focus: (value: boolean) => void) {
    this.#nativeFocus = focus;
    return () => {
      this.#nativeFocus = undefined;
    };
  }
  focus(options?: { lineNumber?: number; character?: number }) {
    if (options?.lineNumber)
      this.setSelections([
        this.caret({
          line: options.lineNumber - 1,
          character: options.character ?? 0,
        }),
      ]);
    this.focusRequest = ++nextFocusRequest;
    this.#notify();
    this.#nativeFocus?.(true);
  }
  blur() {
    this.cancelPrediction();
    this.#nativeFocus?.(false);
  }
  caret(position: Position): EditorSelection {
    const p = this.document.normalizePosition(position);
    return { start: p, end: p, direction: 0 };
  }
  #focus(position: Position) {
    this.focus();
    this.#scrollToPrimaryCaret();
  }
  #scrollToPrimaryCaret() {
    this.reveal++;
    this.#notify();
  }
  #revealLineIfCollapsed(_line: number) {
    this.reveal++;
  }
  #updateSelections(selections: EditorSelection[]) {
    this.cancelPrediction(false);
    this.#selections = selection.mergeOverlappingSelections(selections);
    if (!this.#selections.length)
      this.#selections = [this.caret({ line: 0, character: 0 })];
    this.#notify();
    this.#schedulePrediction();
  }
  #applyChangeToLineAnnotations(change: TextDocumentChange) {
    return applyDocumentChangeToLineAnnotations(change, this.#lineAnnotations);
  }
  #applyChange(
    change: TextDocumentChange,
    nextSelections?: EditorSelection[],
    annotations?: EditorLineAnnotation<EType, LAnnotation>[],
  ) {
    this.cancelPrediction(false);
    if (nextSelections) this.#selections = nextSelections;
    if (annotations) this.#lineAnnotations = annotations;
    const transaction = getTextDocumentChangeTransaction(change);
    if (transaction && this.#options.editPrediction)
      this.#predictionHistory = recordEditPrediction(
        this.#predictionHistory,
        this.#file.name,
        this.document,
        transaction,
        this.#source,
      );
    this.updateSearch({}, false);
    this.reveal++;
    this.#notify();
    this.#schedulePrediction();
    this.#options.onChange?.({
      changes: change.changes,
      file: this.getFile(),
      editor: this,
      lineAnnotations: this.#lineAnnotations,
    });
  }
  applyEdits(edits: TextEdit[], updateHistory = true) {
    if (this.#options.readOnly) return;
    const before = this.#selections,
      offsets = before.map(
        (s) =>
          [
            this.document.offsetAt(s.start),
            this.document.offsetAt(s.end),
          ] as const,
      ),
      resolved = this.document
        .resolveEdits(edits)
        .sort((a, b) => a.start - b.start);
    const change = this.document.applyEdits(edits, updateHistory, before);
    if (!change) return;
    const next = remapSelectionsAfterEdits(
      this.document,
      before,
      offsets,
      resolved,
    );
    if (updateHistory) this.document.setLastUndoSelectionsAfter(next);
    this.#applyChange(change, next, this.#applyChangeToLineAnnotations(change));
  }

  replaceDocument(file: FileContents) {
    if (file.contents === this.getText() && file.name === this.#file.name)
      return;
    this.cancelPrediction(false);
    this.#file = { ...file };
    this.#original = { ...file };
    this.#editSession = {
      document: new TextDocument<EType, LAnnotation>(
        file.name,
        file.contents,
        file.lang ?? getFiletypeFromFileName(file.name),
      ),
    };
    this.#selections = [this.caret({ line: 0, character: 0 })];
    this.view = { scrollLeft: 0, scrollTop: 0 };
    this.scrollRequest++;
    this.updateSearch({}, false);
    this.#notify();
  }
  insertText(text: string) {
    if (this.#options.readOnly) return;
    const surround = selection.getAutoSurroundReplacementTexts(
      this.document,
      this.#selections,
      text,
      this.#options.autoSurround ?? "default",
    );
    if (surround) {
      this.#replaceSelectionText(surround);
      return;
    }
    this.#replaceSelectionText(text);
  }
  delete(forward = false) {
    if (!this.#options.readOnly) this.#deleteSelectionText(forward);
  }
  undo() {
    if (!this.#options.readOnly) this.#applyHistoryChange("undo");
  }
  redo() {
    if (!this.#options.readOnly) this.#applyHistoryChange("redo");
  }
  runCommand(command: EditorCommand) {
    if (
      this.#options.readOnly &&
      ![
        "selectAll",
        "findNextMatch",
        "openSearchPanel",
        "openSearchReplacePanel",
        "simplifySelection",
        "moveCursorToDocStart",
        "moveCursorToDocEnd",
        "expandSelectionDocStart",
        "expandSelectionDocEnd",
      ].includes(command)
    )
      return;
    this.#runCommand(command);
  }
  move(
    shortcut: Parameters<typeof selection.mapCursorMove>[2],
    extend = false,
  ) {
    this.#updateSelections(
      extend
        ? selection.mapSelectionShift(
            this.document,
            this.#selections,
            shortcut,
            this.cursorOptions,
          )
        : selection.mapCursorMove(
            this.document,
            this.#selections,
            shortcut,
            this.cursorOptions,
          ),
    );
    this.#scrollToPrimaryCaret();
  }
  #deleteHardLineForward() {
    const r = selection.applyDeleteHardLineForwardToSelections(
      this.document,
      this.#selections,
      this.#lineAnnotations,
    );
    if (r.change)
      this.#applyChange(
        r.change,
        r.nextSelections,
        this.#applyChangeToLineAnnotations(r.change),
      );
  }
  #openSearchPanel(mode: "find" | "replace") {
    this.search.mode = mode;
    const first = this.#selections.at(-1);
    if (first && !isCollapsedSelection(first)) {
      this.search.text = this.document.getText(first);
    }
    this.updateSearch({});
  }
  setSearchMode(mode: "find" | "replace") {
    this.search.mode = mode;
    this.#notify();
  }
  closeSearch() {
    this.search.mode = undefined;
    this.#notify();
    this.focus();
  }
  updateSearch(params: Partial<SearchParams>, notify = true) {
    Object.assign(this.search, params);
    try {
      this.search.matches = this.search.text
        ? this.document.search(this.search)
        : [];
      this.search.error = undefined;
    } catch (error) {
      this.search.matches = [];
      this.search.error = String(error);
    }
    this.search.index = Math.min(
      this.search.index,
      this.search.matches.length - 1,
    );
    if (notify) this.#notify();
  }
  navigateSearch(backward = false) {
    if (!this.search.matches.length) return;
    this.search.index =
      (this.search.index + (backward ? -1 : 1) + this.search.matches.length) %
      this.search.matches.length;
    const [a, b] = this.search.matches[this.search.index];
    this.setSelections([
      {
        start: this.document.positionAt(a),
        end: this.document.positionAt(b),
        direction: 1,
      },
    ]);
  }
  replaceMatch(all = false) {
    if (this.#options.readOnly) return;
    const ranges = all
      ? this.search.matches
      : this.search.matches.slice(
          Math.max(0, this.search.index),
          Math.max(0, this.search.index) + 1,
        );
    const text = this.getText();
    const edits = ranges.map(([a, b]) => ({
      range: {
        start: this.document.positionAt(a),
        end: this.document.positionAt(b),
      },
      newText: buildSearchReplacementText(
        (p) => this.document.positionAt(p),
        (p) => this.document.offsetAt(p),
        (l) => this.document.getLineText(l),
        this.search,
        a,
        b,
      ),
    }));
    this.applyEdits(edits);
  }
  async copy(cut = false) {
    const parts = selection.getSelectionClipboardTexts(
      this.document,
      this.#selections,
    );
    const text = parts.join(this.document.eol);
    this.#clipboardSelections = { text, parts };
    const writing = this.#options.clipboard?.writeText(text);
    if (cut && !this.#options.readOnly) {
      const result = selection.resolveSelectionCut(
        this.document,
        this.#selections,
      );
      this.#applyCommandEdits(
        result.edits.map((e) => ({
          range: {
            start: this.document.positionAt(e.start),
            end: this.document.positionAt(e.end),
          },
          newText: e.text,
        })),
        (d) =>
          result.nextSelectionOffsets.map((offset) =>
            this.caret(d.positionAt(offset)),
          ),
      );
    }
    await writing;
    return text;
  }
  async paste(text?: string) {
    text ??= (await this.#options.clipboard?.readText()) ?? "";
    const parts =
      this.#clipboardSelections?.text === text
        ? this.#clipboardSelections.parts
        : undefined;
    if (parts?.length === this.#selections.length)
      this.#replaceSelectionText(parts, undefined, true, "document");
    else this.insertText(this.document.normalizeEol(text));
  }
  handleNativeEvent(event: NativeCodeEvent) {
    this.nativeSequence = event.seq ?? this.nativeSequence;
    if (event.kind === "focus" || event.kind === "blur") {
      const focused = event.kind === "focus";
      if (this.focused !== focused) {
        this.focused = focused;
        if (focused) this.#options.onFocus?.(this);
        else {
          this.cancelPrediction(false);
          this.#options.onBlur?.(this);
        }
        this.#notify();
      }
      return;
    }
    if (event.kind === "layout") {
      if (event.predictionRendered !== undefined)
        this.predictionRendered = event.predictionRendered;
      if (!event.softLines) return;
      const lines = event.softLines ?? {};
      this.cursorOptions = {
        ...this.cursorOptions,
        getSoftLineOffsets: (line) => lines[line],
      };
      return;
    }
    if (event.kind === "scroll") {
      this.view = {
        scrollLeft: event.scrollLeft ?? 0,
        scrollTop: event.scrollTop ?? 0,
      };
      return;
    }
    if (event.kind === "select") {
      if (event.ranges) {
        this.#updateSelections(
          event.ranges.map(([a, b]) =>
            selection.createSelectionFromAnchorAndFocusOffsets(
              this.document,
              a,
              b,
            ),
          ),
        );
        return;
      }
      if (event.side === "deletions") return;
      const s = selection.createSelectionFromAnchorAndFocusOffsets(
        this.document,
        event.anchor ?? 0,
        event.head ?? 0,
      );
      let next = event.addCaret || event.alt ? [...this.#selections, s] : [s];
      if (event.clickCount === 2)
        next = [expandCollapsedSelectionToWord(this.document, s)];
      if ((event.clickCount ?? 0) >= 3) {
        const line = s.start.line;
        next = [
          {
            start: { line, character: 0 },
            end:
              line + 1 < this.document.lineCount
                ? { line: line + 1, character: 0 }
                : { line, character: this.document.getLineLength(line) },
            direction: 1,
          },
        ];
      }
      this.#updateSelections(next);
      return;
    }
    if (event.kind === "insert") {
      this.insertText(event.text ?? "");
      return;
    }
    if (event.kind !== "key") return;
    const key =
      (
        {
          left: "ArrowLeft",
          right: "ArrowRight",
          up: "ArrowUp",
          down: "ArrowDown",
          home: "Home",
          end: "End",
          tab: "Tab",
          enter: "Enter",
          escape: "Escape",
          backspace: "Backspace",
          delete: "Delete",
          pageup: "PageUp",
          pagedown: "PageDown",
          space: " ",
        } as Record<string, string>
      )[event.key ?? ""] ??
      event.key ??
      "";
    const e = {
      key,
      metaKey: !!event.meta,
      ctrlKey: !!event.ctrl,
      altKey: !!event.alt,
      shiftKey: !!event.shift,
    } as KeyboardEvent;
    const primary = isMac ? e.metaKey : e.ctrlKey;
    if (primary && key === "c") {
      void this.copy().catch((error) => {
        this.clipboardError = String(error);
        this.#notify();
      });
      return;
    }
    if (primary && key === "x") {
      void this.copy(true).catch((error) => {
        this.clipboardError = String(error);
        this.#notify();
      });
      return;
    }
    if (primary && key === "v") {
      void this.paste().catch((error) => {
        this.clipboardError = String(error);
        this.#notify();
      });
      return;
    }
    const again = resolveFindAgainShortcut(e, isMac);
    if (again) {
      this.navigateSearch(again === "previous");
      return;
    }
    if (
      (key === "Alt" || key === "alt") &&
      this.#options.editPrediction?.mode === "subtle"
    ) {
      this.predictionRevealed = !this.predictionRevealed;
      this.#notify();
      return;
    }
    if (
      key === "Tab" &&
      this.visiblePrediction &&
      (!this.#nativeFocus || this.predictionRendered) &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (!e.altKey || this.#options.editPrediction?.mode === "subtle")
    ) {
      this.acceptPrediction();
      return;
    }
    if (key === "Escape" && this.search.mode) {
      this.closeSearch();
      return;
    }
    if (key === "Escape" && this.prediction) {
      this.cancelPrediction();
      return;
    }
    const command = resolveEditorCommandFromKeyboardEvent(
      e,
      this.#options.keymap,
      isMac,
    );
    if (command) {
      this.runCommand(command);
      return;
    }
    const macKey = isMac;
    const move =
      primary && !e.altKey && (key === "ArrowLeft" || key === "ArrowRight")
        ? key === "ArrowLeft"
          ? "textStart"
          : "end"
        : macKey && e.ctrlKey && !e.metaKey && !e.altKey
          ? (
              {
                a: "start",
                e: "end",
                p: "up",
                n: "down",
                f: "right",
                b: "left",
              } as const
            )[key as "a"]
          : isMoveCursorShortcut(e);
    if (move) {
      this.move(move, e.shiftKey);
      return;
    }
    if (key === "Backspace" && (e.altKey || primary)) {
      if (this.#options.readOnly) return;
      const r = primary
        ? selection.applyDeleteSoftLineBackwardToSelections(
            this.document,
            this.#selections,
            undefined,
            this.#lineAnnotations,
          )
        : selection.applyDeleteWordBackwardToSelections(
            this.document,
            this.#selections,
            this.#lineAnnotations,
          );
      if (r.change)
        this.#applyChange(
          r.change,
          r.nextSelections,
          this.#applyChangeToLineAnnotations(r.change),
        );
      return;
    }
    if (e.ctrlKey && key === "t" && macKey && !this.#options.readOnly) {
      const r = selection.applyTransposeToSelections(
        this.document,
        this.#selections,
        this.#lineAnnotations,
      );
      if (r.change) this.#applyChange(r.change, r.nextSelections);
      return;
    }
    if (key === "Backspace") {
      this.delete();
      return;
    }
    if (key === "Delete") {
      this.delete(true);
      return;
    }
    if (key === "Enter") {
      this.insertText(this.document.eol);
      return;
    }
    if (key === "PageUp" || key === "PageDown") {
      for (let i = 0; i < (event.viewportLines ?? 20); i++)
        this.move(key === "PageUp" ? "up" : "down", e.shiftKey);
      return;
    }
    if (
      (key === "ArrowLeft" || key === "ArrowRight") &&
      (e.altKey || e.ctrlKey)
    ) {
      const forward = key === "ArrowRight";
      const next = this.#selections.map((s) => {
        const caret = getCaretPosition(s),
          line = this.document.getLineText(caret.line);
        const re = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+|\s+/gu;
        const parts = [...line.matchAll(re)],
          at = caret.character;
        let ch = forward ? line.length : 0;
        for (const part of forward ? parts : [...parts].reverse()) {
          const edge = forward ? part.index + part[0].length : part.index;
          if (forward ? edge > at : edge < at) {
            ch = edge;
            break;
          }
        }
        const target = this.caret({ line: caret.line, character: ch });
        return e.shiftKey ? selection.createSelectionFrom(s, target) : target;
      });
      this.#updateSelections(next);
      this.#scrollToPrimaryCaret();
      return;
    }
  }
  #schedulePrediction() {
    if (
      !this.#options.editPrediction ||
      this.#options.readOnly ||
      this.#disposed
    )
      return;
    if (this.#predictionTimer) clearTimeout(this.#predictionTimer);
    this.#predictionTimer = setTimeout(() => {
      this.#predictionTimer = undefined;
      void this.requestPrediction();
    }, 300);
    this.#predictionTimer.unref?.();
  }
  cancelPrediction(notify = true) {
    if (this.#predictionTimer) clearTimeout(this.#predictionTimer);
    this.#predictionTimer = undefined;
    this.#predictionAbort?.abort();
    this.#predictionAbort = undefined;
    this.prediction = undefined;
    this.predictionRendered = false;
    this.predictionRevealed = false;
    if (notify) this.#notify();
  }
  async requestPrediction() {
    this.cancelPrediction(false);
    const options = this.#options.editPrediction;
    if (
      !options ||
      this.#options.readOnly ||
      this.#selections.length !== 1 ||
      !isCollapsedSelection(this.#selections[0])
    )
      return;
    const path = this.#file.name;
    if (
      options.include &&
      !options.include.some((p) => matchesEditPredictionPattern(path, p))
    )
      return;
    if (options.exclude?.some((p) => matchesEditPredictionPattern(path, p)))
      return;
    const request = buildEditPredictionRequest(
      path,
      this.document,
      this.document.offsetAt(getCaretPosition(this.#selections.at(-1)!)),
      this.#predictionHistory,
      () => true,
    );
    if (!request) return;
    const controller = new AbortController();
    this.#predictionAbort = controller;
    const version = this.document.version;
    try {
      const response = await options.provider.predict(request, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        version !== this.document.version ||
        this.#disposed
      )
        return;
      this.prediction = validatePrediction(this.document, request, response);
      this.predictionError = undefined;
      this.#notify();
    } catch (error) {
      if (!controller.signal.aborted) {
        this.predictionError = String(error);
        this.#notify();
      }
    }
  }
  acceptPrediction() {
    const prediction = this.prediction;
    if (!prediction) return;
    this.#source = "prediction";
    try {
      this.applyEdits([...prediction.edits]);
      this.setSelections([this.caret(prediction.newCursor)]);
    } finally {
      this.#source = "user";
      this.cancelPrediction();
    }
  }
  complete(decision: "accept" | "reject" = "accept") {
    const event = {
      file: this.getFile(),
      originalFile: { ...this.#original },
      editor: this,
    };
    decision = this.#options.onComplete?.(event) ?? decision;
    if (decision === "reject") this.replaceDocument(this.#original);
    else this.#original = this.getFile();
    return event;
  }
  dispose() {
    if (this.#options.editStateKey) {
      if (this.editorType === "file")
        EditStateManager.releaseFile(this.#options.editStateKey, this);
      else EditStateManager.releaseFileDiff(this.#options.editStateKey, this);
    }
    this.cancelPrediction(false);
    this.#disposed = true;
    this.#listeners.clear();
  }
  #runCommand(command: EditorCommand) {
    const textDocument = this.#editSession?.document;
    if (textDocument == null) {
      return;
    }

    switch (command) {
      case "openSearchPanel":
        this.#openSearchPanel("find");
        break;

      case "openSearchReplacePanel":
        this.#openSearchPanel("replace");
        break;

      case "findNextMatch": {
        const selections = this.#selections;
        if (selections === undefined) {
          break;
        }
        const hasCollapsed = selections.some(isCollapsedSelection);
        if (hasCollapsed) {
          const expanded: EditorSelection[] = selections.map((sel) => {
            if (isCollapsedSelection(sel)) {
              return expandCollapsedSelectionToWord(textDocument, sel);
            }
            return sel;
          });
          this.#updateSelections(expanded);
          this.focus();
        } else {
          const nextMatch = findNextMatch(textDocument, selections);
          if (nextMatch !== undefined) {
            this.#updateSelections(nextMatch);
            const primaryMatch = nextMatch.at(-1);
            if (primaryMatch !== undefined) {
              this.#revealLineIfCollapsed(getCaretPosition(primaryMatch).line);
            }
            this.#scrollToPrimaryCaret();
          }
        }
        break;
      }

      case "moveLineUp":
      case "moveLineDown":
        this.#moveSelectedLines(command === "moveLineUp" ? -1 : 1);
        break;

      case "copyLineUp":
      case "copyLineDown":
        this.#copySelectedLines(command === "copyLineUp" ? -1 : 1);
        break;

      case "simplifySelection": {
        const selections = this.#selections;
        const primarySelection = selections?.at(-1);
        if (selections === undefined || primarySelection === undefined) {
          break;
        }
        if (selections.length > 1) {
          this.#updateSelections([primarySelection]);
          this.#focus(getCaretPosition(primarySelection));
        } else if (!isCollapsedSelection(primarySelection)) {
          const caret = getCaretPosition(primarySelection);
          this.#updateSelections([
            { start: caret, end: caret, direction: DirectionNone },
          ]);
          this.#focus(caret);
        }
        break;
      }

      case "insertBlankLine":
        this.#insertBlankLine();
        break;

      case "deleteHardLineForward":
        this.#deleteHardLineForward();
        break;

      case "toggleComment":
      case "toggleBlockComment": {
        const selections = this.#selections;
        if (selections === undefined) {
          break;
        }
        const { lineComment, blockComment } = resolveCommentConfig(
          textDocument.languageId,
          this.#options.languageCommentConfig,
        );
        if (command === "toggleComment" && lineComment !== null) {
          this.#applyCommandEdits(
            resolveLineCommentEdits(textDocument, selections, lineComment),
          );
          break;
        }
        const linewise = command === "toggleComment";
        const result = resolveBlockCommentEdits(
          textDocument,
          selections,
          blockComment,
          linewise,
        );
        if (result !== undefined) {
          this.#applyCommandEdits(
            result.edits,
            linewise
              ? undefined
              : (document) =>
                  result.nextSelectionOffsets.map(
                    ([start, end, direction]) => ({
                      start: document.positionAt(start),
                      end: document.positionAt(end),
                      direction,
                    }),
                  ),
          );
        }
        break;
      }

      case "indent":
      case "outdent":
      case "indentLess":
      case "indentMore":
        if (this.#selections !== undefined) {
          const edits: TextEdit[] = [];
          const nextSelections: EditorSelection[] = [];
          // Line-based indentation is resolved per selection, so overlapping
          // line coverage must share the same leading-whitespace edit.
          const editedLines = new Set<number>();
          // Single-line indent inserts text at each caret. When several carets
          // share a line, indentation inserted by carets to their left shifts
          // them right, so record each one here and offset its resulting
          // position once every edit on the line is known. Without this, later
          // same-line carets land before their own inserted indent.
          const sameLineIndents: Array<{
            line: number;
            startCharacter: number;
            addedLength: number;
            selectionIndex: number;
          }> = [];
          for (const selection of this.#selections) {
            const startLine = selection.start.line;
            const outdent = command === "outdent" || command === "indentLess";
            const lineBased =
              command === "indentLess" || command === "indentMore";
            if (startLine !== selection.end.line || outdent || lineBased) {
              const ret = resolveIndentEdits(
                textDocument,
                selection,
                this.#metrics.tabSize,
                outdent,
              );
              for (const edit of ret[0]) {
                const line = edit.range.start.line;
                if (!editedLines.has(line)) {
                  editedLines.add(line);
                  edits.push(edit);
                }
              }
              nextSelections.push(ret[1]);
            } else {
              const lineChar0 = textDocument.charAt({
                line: startLine,
                character: 0,
              });
              const text =
                lineChar0 === "\t" ? "\t" : " ".repeat(this.#metrics.tabSize);
              edits.push({
                range: selection,
                newText: text,
              });
              sameLineIndents.push({
                line: startLine,
                startCharacter: selection.start.character,
                addedLength:
                  text.length -
                  (selection.end.character - selection.start.character),
                selectionIndex: nextSelections.length,
              });
              const nextPosition = {
                line: selection.start.line,
                character: selection.start.character + text.length,
              };
              nextSelections.push({
                start: nextPosition,
                end: nextPosition,
                direction: DirectionNone,
              });
            }
          }
          for (const indent of sameLineIndents) {
            let shift = 0;
            for (const other of sameLineIndents) {
              if (
                other.line === indent.line &&
                other.startCharacter < indent.startCharacter
              ) {
                shift += other.addedLength;
              }
            }
            if (shift !== 0) {
              const current = nextSelections[indent.selectionIndex];
              const position = {
                line: indent.line,
                character: current.start.character + shift,
              };
              nextSelections[indent.selectionIndex] = {
                start: position,
                end: position,
                direction: DirectionNone,
              };
            }
          }
          const change = textDocument.applyEdits(
            edits,
            true,
            this.#selections,
            nextSelections,
          );
          if (change !== undefined) {
            this.#applyChange(change, nextSelections);
          }
        }
        break;

      case "selectAll": {
        const fullSelection = getDocumentFullSelection(textDocument);
        this.#updateSelections([fullSelection]);
        this.focus();
        break;
      }

      case "moveCursorToDocStart":
      case "moveCursorToDocEnd":
        {
          const atEnd = command === "moveCursorToDocEnd";
          const boundarySelection = getDocumentBoundarySelection(
            textDocument,
            atEnd,
            this.#isDiff,
          );
          this.#updateSelections([boundarySelection]);
          this.#revealLineIfCollapsed(getCaretPosition(boundarySelection).line);
          this.#scrollToPrimaryCaret();
        }
        break;

      case "expandSelectionDocStart":
      case "expandSelectionDocEnd":
        {
          const atEnd = command === "expandSelectionDocEnd";
          const selections = this.#selections;
          if (selections !== undefined) {
            const boundarySelection = getDocumentBoundarySelection(
              textDocument,
              atEnd,
              this.#isDiff,
            );
            this.#updateSelections(
              extendSelections(selections, boundarySelection),
            );
            this.#revealLineIfCollapsed(
              getCaretPosition(boundarySelection).line,
            );
            this.#scrollToPrimaryCaret();
          }
        }
        break;

      case "undo":
      case "redo":
        this.#applyHistoryChange(command);
        break;
    }
  }

  #applyHistoryChange(command: "undo" | "redo"): void {
    const textDocument = this.#editSession?.document;
    if (textDocument == null) {
      return;
    }
    if (
      (command === "undo" && !textDocument.canUndo) ||
      (command === "redo" && !textDocument.canRedo)
    ) {
      return;
    }
    const selections = this.#selections;
    const selectionOffsets = selections?.map(
      (selection) =>
        [
          textDocument.offsetAt(selection.start),
          textDocument.offsetAt(selection.end),
        ] as const,
    );
    const result =
      command === "undo" ? textDocument.undo() : textDocument.redo();
    if (result === undefined) {
      return;
    }
    const [change, recordedSelections, lineAnnotations, selectionEdits] =
      result;
    const nextSelections =
      recordedSelections ??
      (selections !== undefined &&
      selectionOffsets !== undefined &&
      selectionEdits !== undefined
        ? remapSelectionsAfterEdits(
            textDocument,
            selections,
            selectionOffsets,
            selectionEdits,
          )
        : undefined);
    const replayedLineAnnotations =
      lineAnnotations ??
      (this.#lineAnnotations != null
        ? applyDocumentChangeToLineAnnotations(change, this.#lineAnnotations)
        : undefined);
    this.#applyChange(change, nextSelections, replayedLineAnnotations);
  }

  /** Applies one undoable command batch and records its resulting selections. */
  #applyCommandEdits(
    edits: TextEdit[],
    resolveNextSelections?: (
      textDocument: TextDocument<EType, LAnnotation>,
    ) => EditorSelection[],
  ): void {
    const textDocument = this.#editSession?.document;
    const selections = this.#selections;
    if (textDocument === undefined || selections === undefined) {
      return;
    }
    const remapSelections = resolveNextSelections === undefined;
    const selectionOffsets = remapSelections
      ? selections.map(
          (selection) =>
            [
              textDocument.offsetAt(selection.start),
              textDocument.offsetAt(selection.end),
            ] as const,
        )
      : undefined;
    const resolvedEdits = remapSelections
      ? edits
          .map((edit) => {
            const start = textDocument.offsetAt(edit.range.start);
            const end = textDocument.offsetAt(edit.range.end);
            return {
              start: Math.min(start, end),
              end: Math.max(start, end),
              text: edit.newText,
            };
          })
          .sort((a, b) => {
            const startOrder = a.start - b.start;
            return startOrder !== 0 ? startOrder : a.end - b.end;
          })
      : undefined;
    const change = textDocument.applyEdits(
      edits,
      true,
      selections,
      undefined,
      true,
    );
    if (change === undefined) {
      return;
    }
    const nextSelections = remapSelections
      ? remapSelectionsAfterEdits(
          textDocument,
          selections,
          selectionOffsets!,
          resolvedEdits!,
        )
      : resolveNextSelections(textDocument);
    textDocument.setLastUndoSelectionsAfter(nextSelections);
    this.#applyChange(
      change,
      nextSelections,
      this.#applyChangeToLineAnnotations(change),
    );
  }

  /** Copies selected line blocks and keeps the selection in the requested copy. */
  #copySelectedLines(direction: -1 | 1): void {
    const textDocument = this.#editSession?.document;
    const selections = this.#selections;
    if (textDocument === undefined || selections === undefined) {
      return;
    }

    const blocks = getSelectedLineBlocks(selections);
    if (blocks.length === 0) {
      return;
    }
    const copiedLinesBefore: number[] = [];
    let copiedLineCount = 0;
    const edits: TextEdit[] = [];
    for (const block of blocks) {
      copiedLinesBefore.push(copiedLineCount);
      const blockLineCount = block.endLine - block.startLine + 1;
      copiedLineCount += blockLineCount;
      const text = textDocument.getText({
        start: { line: block.startLine, character: 0 },
        end: {
          line: block.endLine,
          character: textDocument.getLineLength(block.endLine),
        },
      });

      if (direction > 0) {
        const position = { line: block.startLine, character: 0 };
        edits.push({
          range: { start: position, end: position },
          newText: text + textDocument.eol,
        });
      } else if (block.endLine < textDocument.lineCount - 1) {
        const position = { line: block.endLine + 1, character: 0 };
        edits.push({
          range: { start: position, end: position },
          newText: text + textDocument.eol,
        });
      } else {
        const position = {
          line: block.endLine,
          character: textDocument.getLineLength(block.endLine),
        };
        edits.push({
          range: { start: position, end: position },
          newText: textDocument.eol + text,
        });
      }
    }

    const nextSelections = selections.map((selection) => {
      const line = selection.start.line;
      let low = 0;
      let high = blocks.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const block = blocks[middle];
        if (line < block.startLine) {
          high = middle - 1;
        } else if (line > block.endLine) {
          low = middle + 1;
        } else {
          low = middle;
          break;
        }
      }
      const blockIndex = Math.max(0, low <= high ? low : high);
      const block = blocks[blockIndex];
      const shift =
        copiedLinesBefore[blockIndex] +
        (direction > 0 ? block.endLine - block.startLine + 1 : 0);
      return {
        start: { ...selection.start, line: selection.start.line + shift },
        end: { ...selection.end, line: selection.end.line + shift },
        direction: selection.direction,
      };
    });
    this.#applyCommandEdits(edits, () => nextSelections);
  }

  /** Inserts an indented blank line after each selection's final line. */
  #insertBlankLine(): void {
    const textDocument = this.#editSession?.document;
    const selections = this.#selections;
    if (textDocument === undefined || selections === undefined) {
      return;
    }

    const selectionLines = selections.map(
      (selection) => getCaretPosition(selection).line,
    );
    const targetLines = Array.from(new Set(selectionLines)).sort(
      (a, b) => a - b,
    );
    const targetIndex = new Map<number, number>();
    const indents = new Map<number, string>();
    const edits: TextEdit[] = [];
    for (let index = 0; index < targetLines.length; index++) {
      const line = targetLines[index];
      const lineText = textDocument.getLineText(line);
      const indent = /^\s*/.exec(lineText)?.[0] ?? "";
      targetIndex.set(line, index);
      indents.set(line, indent);
      const position = {
        line,
        character: textDocument.getLineLength(line),
      };
      edits.push({
        range: { start: position, end: position },
        newText: textDocument.eol + indent,
      });
    }

    const nextSelections = selections.map<EditorSelection>((_, index) => {
      const line = selectionLines[index];
      const position = {
        line: line + 1 + targetIndex.get(line)!,
        character: indents.get(line)!.length,
      };
      return { start: position, end: position, direction: DirectionNone };
    });
    this.#applyCommandEdits(edits, () => nextSelections);
  }

  #moveSelectedLines(direction: -1 | 1): void {
    const textDocument = this.#editSession?.document;
    const selections = this.#selections;
    if (textDocument === undefined || selections === undefined) {
      return;
    }

    const blocks = getSelectedLineBlocks(selections);
    if (
      blocks.length === 0 ||
      (direction < 0 && blocks[0].startLine === 0) ||
      (direction > 0 && blocks.at(-1)!.endLine >= textDocument.lineCount - 1)
    ) {
      return;
    }

    const lineCount = textDocument.lineCount;
    const lineRangeEnd = (line: number): Position =>
      line < lineCount - 1
        ? { line: line + 1, character: 0 }
        : { line, character: textDocument.getLineLength(line) };
    const getLinesText = (
      lines: number[],
      appendFinalLineBreak: boolean,
    ): string => {
      const text = lines
        .map((line) => textDocument.getLineText(line))
        .join(textDocument.eol);
      return appendFinalLineBreak ? text + textDocument.eol : text;
    };

    const edits: TextEdit[] = [];
    if (direction < 0) {
      for (const block of blocks) {
        const previousLine = block.startLine - 1;
        const blockLines: number[] = [];
        for (let line = block.startLine; line <= block.endLine; line++) {
          blockLines.push(line);
        }
        edits.push({
          range: {
            start: { line: previousLine, character: 0 },
            end: lineRangeEnd(block.endLine),
          },
          newText: getLinesText(
            [...blockLines, previousLine],
            block.endLine < lineCount - 1,
          ),
        });
      }
    } else {
      for (let index = blocks.length - 1; index >= 0; index--) {
        const block = blocks[index];
        const nextLine = block.endLine + 1;
        const blockLines: number[] = [];
        for (let line = block.startLine; line <= block.endLine; line++) {
          blockLines.push(line);
        }
        edits.push({
          range: {
            start: { line: block.startLine, character: 0 },
            end: lineRangeEnd(nextLine),
          },
          newText: getLinesText(
            [nextLine, ...blockLines],
            nextLine < lineCount - 1,
          ),
        });
      }
    }

    const lastBlock = blocks.at(-1)!;
    const lastLineLengthAfterMove =
      direction > 0 && lastBlock.endLine === lineCount - 2
        ? textDocument.getLineLength(lastBlock.endLine)
        : textDocument.getLineLength(lineCount - 1);
    const nextSelections = selections.map((selection) =>
      shiftSelectionLines(selection, direction, lineCount, (line) =>
        line === lineCount - 1
          ? lastLineLengthAfterMove
          : textDocument.getLineLength(line),
      ),
    );
    const change = textDocument.applyEdits(
      edits,
      true,
      selections,
      nextSelections,
      true,
    );
    if (change !== undefined) {
      this.#applyChange(change, nextSelections);
    }
  }

  #replaceSelectionText(
    text: string | string[],
    selections = this.#selections,
    undoBoundary = false,
    textOrder: "selection" | "document" = "selection",
  ) {
    if (selections === undefined) {
      return;
    }
    const textDocument = this.#editSession?.document;
    const primarySelection = selections.at(-1);
    if (textDocument === undefined || primarySelection === undefined) {
      return;
    }
    const { nextSelections, change } =
      Array.isArray(text) && text.length === selections.length
        ? applyTextReplaceToSelections<EType, LAnnotation>(
            textDocument,
            selections,
            text,
            this.#lineAnnotations,
            undoBoundary,
            textOrder,
          )
        : applyTextChangeToSelections<EType, LAnnotation>(
            textDocument,
            selections,
            {
              start: textDocument.offsetAt(primarySelection.start),
              end: textDocument.offsetAt(primarySelection.end),
              text: Array.isArray(text) ? text.join(textDocument.eol) : text,
            },
            this.#lineAnnotations,
            undefined,
            undoBoundary,
          );

    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change),
      );
    }
  }

  #deleteSelectionText(forward: boolean = false) {
    const selections = this.#selections;
    const textDocument = this.#editSession?.document;
    if (selections === undefined || textDocument === undefined) {
      return;
    }

    const { nextSelections, change } = applyDeleteCharacterToSelections<
      EType,
      LAnnotation
    >(
      textDocument,
      selections,
      forward,
      this.#lineAnnotations,
      this.#metrics.tabSize,
    );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change),
      );
    }
  }
}
