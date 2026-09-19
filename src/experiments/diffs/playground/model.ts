import {
  Editor,
  type FileContents,
  type FileDiffMetadata,
  type Marker,
  type SelectedLineRange,
} from "../../../diffs";
import type {
  EditorKeymap,
  EditorCommand,
} from "../../../../vendor/pierre/src/editor/command";
import {
  parsePlaygroundSearchParams,
  type PlaygroundUrlState,
} from "../../../../vendor/pierre-playground/searchParams";
import source from "./fixtures.json";
import { PlaygroundChat } from "./chat";

export const fixtures = source as typeof source & {
  diff: FileDiffMetadata;
  virtualFiles: FileDiffMetadata[];
};
export type Example =
  | "playground"
  | "carets"
  | "selection"
  | "find"
  | "history"
  | "shortcuts";
export type Comment = {
  id: number;
  lineNumber: number;
  side: "additions" | "deletions";
  body: string;
  draft?: boolean;
  example?: boolean;
  replies: string[];
  resolved?: boolean;
};
export type Snippet = {
  id: number;
  text: string;
  filename: string;
  start: number;
  end: number;
};
export type PlaygroundState = PlaygroundUrlState & {
  example: Example;
  selectionActions: boolean;
  shortcutsJSON: boolean;
  shortcutQuery: string;
  keymapError: string;
  notice: string;
};
export const EXAMPLES: { value: Example; label: string }[] = [
  { value: "playground", label: "Playground file" },
  { value: "carets", label: "Remote carets and highlights" },
  { value: "selection", label: "Selection actions" },
  { value: "find", label: "Find and replace" },
  { value: "history", label: "Undo history" },
  { value: "shortcuts", label: "Keyboard shortcuts" },
];

export class PlaygroundModel {
  state: PlaygroundState;
  readonly file: Editor<"file">;
  readonly diff: Editor<"file-diff">;
  readonly peers: [Editor<"file">, Editor<"file">];
  readonly selection = new Editor("file", source.selectionFile);
  readonly find = new Editor("file", source.findFile);
  readonly history = new Editor("file", source.historyFile);
  readonly keymap = new Editor("file", {
    name: "keymap.json",
    contents: JSON.stringify(source.keymap, null, 2) + "\n",
  });
  readonly collection = new Map<string, Editor<any>>();
  comments: Record<string, Comment[]> = {
    file: [],
    diff: [
      {
        id: 0,
        lineNumber: 25,
        side: "additions",
        body: "Should we add rate limiting to this endpoint? We might want to prevent abuse.",
        example: true,
        replies: ["Good idea! I'll add that in a follow-up PR."],
      },
    ],
  };
  snippets: Snippet[] = [];
  activePeer = 0;
  baseline: FileContents = source.file;
  #revision = 0;
  #listeners = new Set<() => void>();
  #cleanup: (() => void)[] = [];
  #counter = 0;
  #syncing = false;
  #checkpoint = new WeakMap<
    Editor<any>,
    { text: string; annotations: readonly any[]; comments: Comment[] }
  >();
  #keymap?: EditorKeymap;
  constructor(
    url = "https://diffs.com/playground?view=file",
    readonly chat = new PlaygroundChat(),
  ) {
    const params = new URL(url, "https://diffs.com").searchParams;
    const initial = parsePlaygroundSearchParams((key) => params.get(key));
    this.state = {
      ...initial,
      editPrediction: false,
      example:
        EXAMPLES.find((e) => e.value === params.get("example"))?.value ??
        "playground",
      selectionActions: params.get("selectionActions") === "1",
      shortcutsJSON: false,
      shortcutQuery: "",
      keymapError: "",
      notice: "",
    };
    this.file = new Editor("file", source.file, {
      readOnly: !initial.edit,
      onChange: (e) => this.syncComments("file", e.lineAnnotations),
    });
    this.diff = new Editor("file-diff", source.file, {
      readOnly: !initial.edit,
      onChange: (e) => this.syncComments("diff", e.lineAnnotations),
    });
    this.peers = [0, 1].map(
      (index) =>
        new Editor("file", source.caretFile, {
          onFocus: () => {
            this.activePeer = index;
            this.notify();
          },
          onChange: ({ changes }) => {
            if (this.#syncing) return;
            this.#syncing = true;
            try {
              this.peers[1 - index].applyEdits(
                changes.map((c) => ({ range: c.range, newText: c.text })),
                false,
              );
            } finally {
              this.#syncing = false;
            }
          },
        }),
    ) as typeof this.peers;
    this.find.search.mode = "find";
    this.find.updateSearch({ text: "user" });
    this.seedHistory();
    for (const e of this.editors)
      this.#cleanup.push(e.subscribe(() => this.notify()));
    this.peers.forEach((editor, index) => {
      const caret = source.carets[index];
      editor.setSelections([
        { start: caret.anchor, end: caret.focus, direction: 1 },
      ]);
      let previous = "";
      const update = () => {
        const value = JSON.stringify(editor.selections);
        if (value === previous) return;
        previous = value;
        const s = editor.selections.at(-1)!;
        this.peers[1 - index].setCarets([
          {
            anchor: s.direction < 0 ? s.end : s.start,
            focus: s.direction < 0 ? s.start : s.end,
            metadata: {
              color: caret.metadata.color,
              label: caret.metadata.name,
            },
          },
        ]);
      };
      this.#cleanup.push(editor.subscribe(update));
      update();
    });
    if (initial.edit)
      for (const e of [this.file, this.diff])
        this.#checkpoint.set(e, {
          text: e.getText(),
          annotations: e.lineAnnotations,
          comments: this.comments[this.editorCommentKey(e)] ?? [],
        });
    this.updateMarkers();
  }
  get editors() {
    return [
      this.file,
      this.diff,
      ...this.peers,
      this.selection,
      this.find,
      this.history,
      this.keymap,
      ...this.collection.values(),
    ];
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.#revision;
  notify() {
    this.#revision++;
    for (const listener of this.#listeners) listener();
  }
  get current(): Editor<any> {
    return this.state.example === "carets"
      ? this.peers[this.activePeer]
      : this.state.example === "selection"
        ? this.selection
        : this.state.example === "find"
          ? this.find
          : this.state.example === "history"
            ? this.history
            : this.state.example === "shortcuts"
              ? this.keymap
              : this.state.viewMode === "diff"
                ? this.diff
                : this.file;
  }
  update(patch: Partial<PlaygroundState>) {
    Object.assign(this.state, patch);
    this.updateMarkers();
    this.notify();
  }
  setExample(example: Example) {
    this.update({ example, selectedRange: null });
  }
  updateMarkers() {
    for (const e of [this.file, this.diff]) {
      const markers =
        this.state.showMarkers && !e.options.readOnly
          ? (source.markers as Marker[])
          : [];
      if (e.markers.length !== markers.length) e.setMarkers(markers);
    }
  }
  beginEdit(e = this.current) {
    this.#checkpoint.set(e, {
      text: e.getText(),
      annotations: e.lineAnnotations,
      comments: this.comments[this.editorCommentKey(e)] ?? [],
    });
    e.setOptions({ ...e.options, readOnly: false, keymap: this.#keymap });
    this.update({ edit: e === this.current ? true : this.state.edit });
    e.focus();
  }
  finishEdit(accept: boolean, e = this.current) {
    if (!accept) {
      const checkpoint = this.#checkpoint.get(e);
      if (checkpoint) {
        e.replaceDocument({ ...e.getFile(), contents: checkpoint.text });
        e.setLineAnnotations([...checkpoint.annotations]);
        this.comments = {
          ...this.comments,
          [this.editorCommentKey(e)]: checkpoint.comments,
        };
      }
    } else if (e === this.diff) this.baseline = e.getFile();
    e.setOptions({ ...e.options, readOnly: true });
    this.update({ edit: e === this.current ? false : this.state.edit });
  }
  resetCurrent() {
    const e = this.current;
    const f =
      e === this.file || e === this.diff
        ? source.file
        : e === this.find
          ? source.findFile
          : e === this.selection
            ? source.selectionFile
            : e === this.history
              ? source.historyFile
              : e === this.keymap
                ? {
                    name: "keymap.json",
                    contents: JSON.stringify(source.keymap, null, 2) + "\n",
                  }
                : source.caretFile;
    e.replaceDocument(f);
    if (e === this.diff) this.baseline = source.file;
    if (e === this.history) this.seedHistory();
    if (this.state.example === "carets")
      this.peers.forEach((peer) => peer.replaceDocument(source.caretFile));
    this.update({ notice: "" });
  }
  seedHistory() {
    this.history.replaceDocument(source.historyFile);
    for (const step of source.historyEdits) {
      const at = this.history.getText().indexOf(step.find);
      if (at < 0)
        throw Error("History fixture no longer contains " + step.label);
      this.history.applyEdits([
        {
          range: {
            start: this.history.document.positionAt(at),
            end: this.history.document.positionAt(at + step.find.length),
          },
          newText: step.replace,
        },
      ]);
    }
  }
  get historyStep() {
    let text = source.historyFile.contents;
    if (this.history.getText() === text) return 0;
    for (const [i, edit] of source.historyEdits.entries()) {
      text = text.replace(edit.find, edit.replace);
      if (text === this.history.getText()) return i + 1;
    }
    return -1;
  }
  jumpHistory(to: number) {
    let at = this.historyStep;
    if (at < 0) return;
    while (at > to && this.history.canUndo) {
      this.history.undo();
      at--;
    }
    while (at < to && this.history.canRedo) {
      this.history.redo();
      at++;
    }
  }
  addSnippet(editor = this.current) {
    const selected = editor.selections.at(-1)!;
    const text = editor.document.getText(selected);
    if (!text.trim()) return;
    this.snippets = [
      ...this.snippets,
      {
        id: ++this.#counter,
        text,
        filename: editor.getFile().name,
        start: selected.start.line + 1,
        end: selected.end.line + (selected.end.character > 0 ? 1 : 0),
      },
    ];
    this.notify();
  }
  sendChat() {
    if (
      !this.chat.store.chat.draft.trim() ||
      this.chat.store.state.busy[this.chat.store.chat.id]
    )
      return Promise.resolve();
    const snippets = this.snippets;
    this.snippets = [];
    this.notify();
    return this.chat.send(snippets);
  }
  removeSnippet(id: number) {
    this.snippets = this.snippets.filter((s) => s.id !== id);
    this.notify();
  }
  editorCommentKey(editor: Editor<any>) {
    return editor === this.diff
      ? "diff"
      : ([...this.collection].find(([, value]) => value === editor)?.[0] ??
          "file");
  }
  get commentKey() {
    return this.state.viewMode === "diff" ? "diff" : "file";
  }
  addComment(
    lineNumber: number,
    side: "additions" | "deletions",
    owner?: string,
  ) {
    const key = owner ?? this.commentKey;
    this.comments = {
      ...this.comments,
      [key]: [
        ...(this.comments[key] ?? []),
        {
          id: ++this.#counter,
          lineNumber,
          side,
          body: "",
          replies: [],
          draft: true,
        },
      ],
    };
    this.update({ showAnnotations: true });
  }
  changeComment(id: number, patch: Partial<Comment>) {
    this.comments = Object.fromEntries(
      Object.entries(this.comments).map(([key, comments]) => [
        key,
        comments.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      ]),
    );
    this.notify();
  }
  deleteComment(id: number) {
    this.comments = Object.fromEntries(
      Object.entries(this.comments).map(([key, comments]) => [
        key,
        comments.filter((c) => c.id !== id),
      ]),
    );
    this.notify();
  }
  syncComments(key: string, annotations: readonly any[]) {
    if (!this.comments[key]?.length) return;
    const positions = new Map(
      annotations.map((a) => [a.metadata?.id, a.lineNumber]),
    );
    this.comments = {
      ...this.comments,
      [key]: this.comments[key].map((c) =>
        positions.has(c.id) ? { ...c, lineNumber: positions.get(c.id) } : c,
      ),
    };
    this.notify();
  }
  applyKeymap() {
    try {
      const value: unknown = JSON.parse(this.keymap.getText());
      const allowed = new Set(Object.keys(source.commandLabels));
      if (
        !Array.isArray(value) ||
        value.some(
          (group) =>
            !group ||
            typeof group !== "object" ||
            !group.bindings ||
            typeof group.bindings !== "object" ||
            Array.isArray(group.bindings) ||
            (group.platform !== undefined &&
              !["mac", "linux", "windows"].includes(group.platform)) ||
            Object.entries(group.bindings).some(
              ([key, command]) =>
                !key || typeof command !== "string" || !allowed.has(command),
            ),
        )
      )
        throw Error(
          "Use an array of binding groups with valid commands and platform names.",
        );
      this.#keymap = value as EditorKeymap;
      for (const e of this.editors)
        if (e !== this.keymap)
          e.setOptions({ ...e.options, keymap: this.#keymap });
      this.update({
        keymapError: "",
        notice: "Keymap applied to playground editors.",
      });
    } catch (error) {
      this.update({
        keymapError: error instanceof Error ? error.message : String(error),
        notice: "",
      });
    }
  }
  get shortcutRows() {
    const query = this.state.shortcutQuery
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return source.keymap
      .flatMap((group) =>
        Object.entries(group.bindings)
          .filter(([, command]) => command)
          .map(([shortcut, command]) => ({
            platform: "platform" in group ? group.platform : "all",
            shortcut,
            command: command!,
            action:
              source.commandLabels[
                command as keyof typeof source.commandLabels
              ],
          })),
      )
      .filter((r) =>
        [
          r.shortcut,
          r.shortcut.replace("cmdOrCtrl", "cmd"),
          r.shortcut.replace("cmdOrCtrl", "ctrl"),
          r.shortcut.replace("cmdOrCtrl", "cmd").replaceAll("+", " "),
          r.shortcut.replace("cmdOrCtrl", "ctrl").replaceAll("+", " "),
          r.command,
          r.action,
          r.platform === "all"
            ? "all platforms mac macos windows linux"
            : r.platform === "mac"
              ? "mac macos"
              : r.platform,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
  }
  collectionEditor(id: string, file: FileContents, diff: boolean) {
    let editor = this.collection.get(id);
    if (!editor) {
      editor = new Editor(diff ? "file-diff" : "file", file, {
        keymap: this.#keymap,
        readOnly: true,
        onChange: (e) => this.syncComments(id, e.lineAnnotations),
      });
      this.collection.set(id, editor);
      this.#cleanup.push(editor.subscribe(() => this.notify()));
    }
    return editor;
  }
  link() {
    const s = this.state,
      url = new URL("https://diffs.com/playground");
    const values = {
      view: s.viewMode,
      layout: s.diffStyle,
      mode: s.colorMode,
      light: s.lightTheme,
      dark: s.darkTheme,
      indicators: s.diffIndicators,
      inline: s.lineDiffType,
      hover: s.lineHoverHighlight,
      hunks: s.hunkSeparators,
      bg: s.disableBackground ? "0" : "1",
      ln: s.disableLineNumbers ? "0" : "1",
      wrap: s.overflow === "wrap" ? "1" : "0",
      annot: s.showAnnotations ? "1" : "0",
      markers: s.showMarkers ? "1" : "0",
      select: s.enableLineSelection ? "1" : "0",
      gutter: s.enableGutterUtility ? "1" : "0",
      edit: s.edit ? "edit" : "review",
    };
    for (const [key, value] of Object.entries(values))
      url.searchParams.set(key, value);
    if (s.selectionActions) url.searchParams.set("selectionActions", "1");
    if (s.example !== "playground") url.searchParams.set("example", s.example);
    return url.href;
  }
  dispose() {
    this.chat.dispose();
    this.#cleanup.forEach((f) => f());
    this.editors.forEach((e) => e.dispose());
    this.#listeners.clear();
  }
}
