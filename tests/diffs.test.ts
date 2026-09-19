import { describe, test, expect } from "bun:test";
import { Editor } from "../src/diffs/editor";
import {
  parseDiffFromFile,
  diffAcceptRejectHunk,
  parsePatchFiles,
} from "../src/diffs/core";
import { wordRanges } from "../src/diffs/layout";
const file = (contents: string, name = "a.ts") => ({ name, contents });
const caret = (character: number, line = 0) => ({
  start: { line, character },
  end: { line, character },
  direction: 0 as const,
});
const range = (start: number, end: number, line = 0) => ({
  start: { line, character: start },
  end: { line, character: end },
  direction: 1 as const,
});
const editor = (
  text: string,
  options: ConstructorParameters<typeof Editor>[2] = {},
) => new Editor("file", file(text), options);
describe("Native Pierre editor controller", () => {
  test("typing, grouped undo, redo and branch after undo", () => {
    const e = editor("");
    for (const c of "hello") e.insertText(c);
    expect(e.getText()).toBe("hello");
    e.undo();
    expect(e.getText()).toBe("");
    e.redo();
    expect(e.getText()).toBe("hello");
    e.undo();
    e.insertText("new");
    expect(e.canRedo).toBe(false);
  });
  test("grapheme movement and deletion preserve Unicode", () => {
    const e = editor("a👩‍💻e\u0301中");
    e.setSelections([caret(1)]);
    e.move("right");
    expect(e.selections[0].start.character).toBe(6);
    e.delete();
    expect(e.getText()).toBe("ae\u0301中");
    e.move("right");
    e.delete();
    expect(e.getText()).toBe("a中");
    e.undo();
    expect(e.getText()).toBe("a👩‍💻e\u0301中");
  });
  test("CRLF paste and undo preserve line endings", async () => {
    const e = editor("a\r\nb\r\n");
    e.setSelections([caret(1)]);
    await e.paste("\nx\ny");
    expect(e.getText()).toBe("a\r\nx\r\ny\r\nb\r\n");
    e.undo();
    expect(e.getText()).toBe("a\r\nb\r\n");
  });
  test("multiple cursors keep document order and one undo entry", () => {
    const e = editor("cat cat cat");
    e.setSelections([range(8, 11), range(0, 3), range(4, 7)]);
    e.insertText("dogs");
    expect(e.getText()).toBe("dogs dogs dogs");
    expect(e.selections.map((s) => s.start.character)).toEqual([14, 4, 9]);
    e.undo();
    expect(e.getText()).toBe("cat cat cat");
  });
  test("public selection direction and reversed ranges match source", () => {
    const e = editor("abcdef");
    e.setSelections([
      {
        start: { line: 0, character: 5 },
        end: { line: 0, character: 1 },
        direction: "forward",
      },
    ]);
    expect(e.selections).toEqual([
      {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 5 },
        direction: -1,
      },
    ]);
  });
  test("next occurrence expands first, then adds cursors", () => {
    const e = editor("cat cat cat");
    e.runCommand("findNextMatch");
    expect(e.document.getText(e.selections[0])).toBe("cat");
    e.runCommand("findNextMatch");
    expect(e.selections.length).toBe(2);
    e.insertText("dog");
    expect(e.getText()).toBe("dog dog cat");
  });
  test("surround over multiple selections", () => {
    const e = editor("a b");
    e.setSelections([range(0, 1), range(2, 3)]);
    e.insertText("(");
    expect(e.getText()).toBe("(a) (b)");
    e.undo();
    expect(e.getText()).toBe("a b");
  });
  test("indent and outdent with overlapping selected lines", () => {
    const e = editor("a\nb\nc");
    e.setSelections([
      {
        start: { line: 0, character: 0 },
        end: { line: 2, character: 1 },
        direction: 1,
      },
    ]);
    e.runCommand("indent");
    expect(e.getText()).toBe("  a\n  b\n  c");
    e.runCommand("outdent");
    expect(e.getText()).toBe("a\nb\nc");
  });
  test("same-line indentation maps every cursor", () => {
    const e = editor("abc");
    e.setSelections([caret(0), caret(2)]);
    e.runCommand("indent");
    expect(e.getText()).toBe("  ab  c");
    expect(e.selections.map((s) => s.start.character)).toEqual([2, 6]);
  });
  test("line move and copy preserve the final newline", () => {
    const e = editor("one\ntwo\nthree");
    e.setSelections([caret(1, 1)]);
    e.runCommand("moveLineUp");
    expect(e.getText()).toBe("two\none\nthree");
    e.runCommand("copyLineDown");
    expect(e.getText()).toBe("two\ntwo\none\nthree");
    e.undo();
    e.undo();
    expect(e.getText()).toBe("one\ntwo\nthree");
  });
  test("insert blank line preserves indentation", () => {
    const e = editor("  hello\nnext");
    e.setSelections([caret(4)]);
    e.runCommand("insertBlankLine");
    expect(e.getText()).toBe("  hello\n  \nnext");
    expect(e.selections[0].start).toEqual({ line: 1, character: 2 });
  });
  test("language comment syntax follows the file name", () => {
    const e = new Editor("file", file("print(1)", "a.py"));
    e.runCommand("toggleComment");
    expect(e.getText()).toBe("# print(1)");
    e.runCommand("toggleComment");
    expect(e.getText()).toBe("print(1)");
  });
  test("block comment command and undo", () => {
    const e = editor("alpha beta");
    e.setSelections([range(0, 5)]);
    e.runCommand("toggleBlockComment");
    expect(e.getText()).toBe("/* alpha */ beta");
    e.undo();
    expect(e.getText()).toBe("alpha beta");
  });
  test("programmatic edits remap selections and history without metadata", () => {
    const e = editor("abc");
    e.setSelections([caret(2)]);
    e.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: "X",
        },
      ],
      false,
    );
    expect(e.selections[0].start.character).toBe(3);
    e.undo();
    expect(e.getText()).toBe("abc");
    expect(e.selections[0].start.character).toBe(2);
  });
  test("read-only permits selection and search but blocks edits", () => {
    const e = editor("abc", { readOnly: true });
    e.runCommand("selectAll");
    e.delete();
    e.insertText("x");
    e.runCommand("toggleComment");
    expect(e.getText()).toBe("abc");
    expect(e.canUndo).toBe(false);
    e.runCommand("openSearchPanel");
    expect(e.search.mode).toBe("find");
  });
  test("search case, word boundary, regular expression captures and replace-all", () => {
    const e = editor("foo food FOO\nfoo 123");
    e.updateSearch({ text: "foo", wholeWord: true });
    expect(e.search.matches.length).toBe(3);
    e.updateSearch({ caseSensitive: true });
    expect(e.search.matches.length).toBe(2);
    e.updateSearch({
      text: "(foo) (\\d+)",
      regex: true,
      wholeWord: false,
      replaceText: "$2:$1",
    });
    e.replaceMatch(true);
    expect(e.getText()).toBe("foo food FOO\n123:foo");
    e.undo();
    expect(e.getText()).toBe("foo food FOO\nfoo 123");
  });
  test("search next and previous cycle", () => {
    const e = editor("a a a");
    e.updateSearch({ text: "a" });
    e.navigateSearch();
    expect(e.search.index).toBe(0);
    e.navigateSearch(true);
    expect(e.search.index).toBe(2);
  });
  test("cut captures its range before an asynchronous clipboard write", async () => {
    let release!: () => void;
    let copied = "";
    const e = editor("one\ntwo", {
      clipboard: {
        readText: () => copied,
        writeText: async (text) => {
          copied = text;
          await new Promise<void>((r) => (release = r));
        },
      },
    });
    const copying = e.copy(true);
    e.setSelections([caret(0)]);
    e.insertText("X");
    release();
    await copying;
    expect(copied).toBe("one\n");
    expect(e.getText()).toBe("Xtwo");
  });
  test("clipboard distributes cursor fragments", async () => {
    let clipboard = "";
    const e = editor("one two", {
      clipboard: {
        readText: () => clipboard,
        writeText: (t) => {
          clipboard = t;
        },
      },
    });
    e.setSelections([range(0, 3), range(4, 7)]);
    await e.copy();
    e.setSelections([caret(0), caret(7)]);
    await e.paste();
    expect(e.getText()).toBe("oneone twotwo");
  });
  test("native word-delete and transpose commands", () => {
    const e = editor("hello world");
    e.setSelections([caret(11)]);
    e.handleNativeEvent({ kind: "key", key: "backspace", alt: true });
    expect(e.getText()).toBe("hello ");
    e.handleNativeEvent({ kind: "key", key: "t", ctrl: true });
    expect(e.getText()).toBe("hell o");
  });
  test("wrapped arrows use native soft-line offsets", () => {
    const e = editor("abcdefghijklmnopqrst");
    e.handleNativeEvent({
      kind: "layout",
      softLines: { 0: [0, 5, 10, 15, 20] },
    });
    e.setSelections([caret(2)]);
    e.move("down");
    expect(e.selections[0].start.character).toBe(7);
    e.move("down", true);
    expect(e.selections[0].end.character).toBe(12);
  });
  test("vertical goal column survives short lines", () => {
    const e = editor("abcdefgh\nx\nabcdefgh");
    e.setSelections([caret(7)]);
    e.move("down");
    e.move("down");
    expect(e.selections[0].start).toEqual({ line: 2, character: 7 });
  });
  test("annotations move with edits and undo", () => {
    const e = editor("one\ntwo");
    e.setLineAnnotations([{ lineNumber: 2, metadata: "note" }]);
    e.insertText("\n");
    expect(e.lineAnnotations[0].lineNumber).toBe(3);
    e.undo();
    expect(e.lineAnnotations[0].lineNumber).toBe(2);
  });
  test("stale predictions cannot change the document", async () => {
    let finish!: (v: any) => void;
    let signal!: AbortSignal;
    const e = editor("hello", {
      editPrediction: {
        provider: {
          predict: async (_, ctx) => {
            signal = ctx.signal;
            return new Promise((r) => (finish = r));
          },
        },
      },
    });
    const pending = e.requestPrediction();
    e.insertText("X");
    expect(signal.aborted).toBe(true);
    finish({
      edits: [{ range: range(0, 5), newText: "oops" }],
      newCursor: { line: 0, character: 4 },
    });
    await pending;
    expect(e.prediction).toBeUndefined();
    expect(e.getText()).toBe("Xhello");
  });
  test("prediction accepts as one undoable edit", async () => {
    const e = editor("hello", {
      editPrediction: {
        provider: {
          predict: async () => ({
            edits: [{ range: range(0, 5), newText: "goodbye" }],
            newCursor: { line: 0, character: 7 },
          }),
        },
      },
    });
    await e.requestPrediction();
    e.acceptPrediction();
    expect(e.getText()).toBe("goodbye");
    e.undo();
    expect(e.getText()).toBe("hello");
  });
  test("prediction path filters avoid calls", async () => {
    let calls = 0;
    const e = editor("x", {
      editPrediction: {
        include: ["**/*.py"],
        provider: {
          predict: async () => {
            calls++;
            return { edits: [], newCursor: { line: 0, character: 0 } };
          },
        },
      },
    });
    await e.requestPrediction();
    expect(calls).toBe(0);
  });
  test("completion can restore the original document", () => {
    const e = editor("before");
    e.runCommand("selectAll");
    e.insertText("after");
    const result = e.complete("reject");
    expect(result.file.contents).toBe("after");
    expect(e.getText()).toBe("before");
  });
});
describe("Diff model and inline spans", () => {
  test("accept and reject preserve the rest of a file", () => {
    const d = parseDiffFromFile(file("a\nb\nc\n"), file("a\nB\nc\n"));
    expect(diffAcceptRejectHunk(d, 0, "reject").additionLines.join("")).toBe(
      "a\nb\nc\n",
    );
    expect(diffAcceptRejectHunk(d, 0, "accept").deletionLines.join("")).toBe(
      "a\nB\nc\n",
    );
  });
  test("character and word changes use UTF-16 ranges", () => {
    expect(wordRanges("a🙂b", "a🙂c", "char")).toEqual({
      before: [[3, 4]],
      after: [[3, 4]],
    });
    expect(wordRanges("foo", "bar", "none")).toEqual({ before: [], after: [] });
  });
  test("malformed patches do not become silent file edits", () => {
    expect(() =>
      parsePatchFiles(
        "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,20 +1,1 @@\n-a\n+b\n",
        undefined,
        true,
      ),
    ).toThrow();
  });
});

test("retained sessions restore document, selections, history and view", () => {
  const e = new Editor("file", file("original"), {
    editStateKey: "retain-test",
  });
  e.setSelections([caret(8)]);
  e.insertText("!");
  e.setViewState({ view: { scrollTop: 100, scrollLeft: 10 } });
  expect(
    () => new Editor("file", file("bad"), { editStateKey: "retain-test" }),
  ).toThrow();
  e.dispose();
  const next = new Editor("file", file("original"), {
    editStateKey: "retain-test",
  });
  expect(next.getText()).toBe("original!");
  expect(next.view.scrollTop).toBe(100);
  expect(next.selections[0].start.character).toBe(9);
  next.undo();
  expect(next.getText()).toBe("original");
  next.dispose();
});

test("incremental TextMate highlighting matches a fresh Shiki tokenization", async () => {
  const { highlight, highlighter, highlightStats } =
    await import("../src/diffs/highlight");
  const code = 'const x = 1;\n/* comment */\nconst y = "hello";\n';
  const f = { name: "incremental.ts", contents: code };
  const first = highlight(f, "pierre-dark");
  const before = highlightStats.tokenizedLines;
  const changed = code.replace("1", "20");
  const next = highlight({ ...f, contents: changed }, "pierre-dark");
  expect(highlightStats.tokenizedLines - before).toBeLessThan(3);
  expect(next[2]).toBe(first[2]);
  const source = highlighter.codeToTokens(changed, {
    lang: "typescript",
    theme: "pierre-dark",
  }).tokens;
  for (let i = 0; i < source.length; i++) {
    const expanded = source[i].flatMap((t) =>
      Array.from({ length: t.content.length }, () => t.color!),
    );
    const actual = next[i].flatMap((t) =>
      Array.from({ length: t.end - t.start }, () => t.color!),
    );
    expect(actual).toEqual(expanded);
  }
  const opened = highlight(
    { ...f, contents: changed.replace("/* comment */", "/* comment") },
    "pierre-dark",
  );
  expect(opened[2]).not.toEqual(next[2]);
});

test("the native document bridge coalesces edits before a frame acknowledgement", async () => {
  const { DocumentBridge } = await import("../src/diffs/bridge");
  const { fileRows } = await import("../src/diffs/layout");
  const { pierreDark } = await import("../src/diffs/theme");
  const bridge = new DocumentBridge();
  const spec = (text: string) => ({
    text,
    oldText: "",
    rows: fileRows({ name: "bridge.txt", contents: text }, pierreDark),
  });
  const original = bridge.update(spec("one\ntwo\nthree"));
  const a = bridge.update(spec("1one\ntwo\nthree"));
  const b = bridge.update(spec("12one\ntwo\nthree"));
  expect(a.patch?.base).toBe(original.spec.documentVersion);
  expect(b.patch?.base).toBe(a.patch?.version);
  expect(b.patch?.chain?.map((p) => p.version)).toEqual([
    a.patch!.version,
    b.patch!.version,
  ]);
  expect(b.patch?.rows.length).toBe(1);
  expect(b.patch?.shift.additions).toEqual([1, 0]);
  bridge.acknowledge(b.patch!.version);
  const c = bridge.update(spec("12one\ntwo\nthree\nfour"));
  expect(c.patch?.base).toBe(b.patch?.version);
  expect(c.patch?.rows.length).toBe(1);
});

describe("Prediction provider boundaries", () => {
  const result = (edits: any[], newCursor = { line: 0, character: 1 }) => ({
    edits,
    newCursor,
  });
  const insert = (at: number, text = "x") => ({
    range: range(at, at),
    newText: text,
  });
  for (const [name, response] of [
    ["empty", result([])],
    ["too many", result(Array.from({ length: 257 }, () => insert(0)))],
    ["outside the document", result([insert(100)])],
    ["negative", result([insert(-1)])],
    [
      "overlap",
      result([
        { range: range(0, 3), newText: "x" },
        { range: range(2, 4), newText: "y" },
      ]),
    ],
    ["split surrogate", result([insert(2)])],
    ["oversized", result([insert(0, "x".repeat(128 * 1024 + 1))])],
    ["invalid cursor", result([insert(0)], { line: 40, character: 0 })],
    ["unchanged", result([{ range: range(0, 1), newText: "a" }])],
  ] as const)
    test(`rejects ${name}`, async () => {
      const e = editor("a🙂b", {
        editPrediction: { provider: { predict: async () => response } },
      });
      await e.requestPrediction();
      expect(e.prediction).toBeUndefined();
      expect(e.getText()).toBe("a🙂b");
      e.dispose();
    });
  test("typing schedules one debounced request", async () => {
    let calls = 0;
    const e = editor("a", {
      editPrediction: {
        provider: {
          predict: async () => {
            calls++;
            return result([insert(0)]);
          },
        },
      },
    });
    e.insertText("b");
    e.insertText("c");
    await Bun.sleep(350);
    expect(calls).toBe(1);
    expect(e.prediction).toBeDefined();
    e.dispose();
  });
  test("subtle predictions require an explicit reveal", async () => {
    const e = editor("a", {
      editPrediction: {
        mode: "subtle",
        provider: { predict: async () => result([insert(0)]) },
      },
    });
    await e.requestPrediction();
    expect(e.visiblePrediction).toBeUndefined();
    e.handleNativeEvent({ kind: "key", key: "alt" });
    expect(e.visiblePrediction).toBeDefined();
    e.handleNativeEvent({ kind: "key", key: "tab", alt: true });
    expect(e.getText()).toBe("xa");
    e.dispose();
  });
});

test("ANSI files use native text colors and omit escape sequences", async () => {
  const { fileRows } = await import("../src/diffs/layout");
  const { pierreDark } = await import("../src/diffs/theme");
  const rows = fileRows(
    {
      name: "terminal.ansi",
      lang: "ansi",
      contents: "\x1b[31mred\x1b[0m plain\n",
    },
    pierreDark,
  );
  expect(rows[0].left?.text).toBe("red plain");
  expect(rows[0].left?.tokens[0].color).not.toBe(
    rows[0].left?.tokens.at(-1)?.color,
  );
});

test("external editor controllers have a default clipboard adapter", async () => {
  const { systemClipboard } = await import("../src/diffs/clipboard");
  const e = editor("text");
  expect(e.options.clipboard).toBe(systemClipboard);
  e.setOptions({ readOnly: true });
  expect(e.options.clipboard).toBe(systemClipboard);
  e.dispose();
});
test("a read-only transpose command cannot change text", () => {
  const e = editor("abcd", { readOnly: true });
  e.setSelections([caret(2)]);
  e.handleNativeEvent({ kind: "key", key: "t", ctrl: true });
  expect(e.getText()).toBe("abcd");
  e.dispose();
});
test("completion callbacks can reject an edited document", () => {
  const e = editor("before", { onComplete: () => "reject" });
  e.insertText("x");
  e.complete();
  expect(e.getText()).toBe("before");
  e.dispose();
});
