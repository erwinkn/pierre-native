import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { pierreDark } from "../src/diffs/theme";
import { createTestRoot } from "@gpuix/react/testing";
import { createTwoFilesPatch } from "diff";
import { UIProvider, Box, Label, column } from "../src/components/foundation";
import {
  File,
  FileDiff,
  CodeView,
  FileStream,
  Editor,
  parsePatchFiles,
  type CommonCodeProps,
} from "../src/diffs";
process.env.GPUIX_BACKGROUND = "1";
const root = createTestRoot({ width: 1000, height: 640 }),
  r = root.renderer;
let e = new Editor("file", {
    name: "gestures.txt",
    contents: "alpha beta\ncharlie delta\necho fox\n",
  }),
  props: Partial<CommonCodeProps> = {},
  width = 1000;
const draw = () =>
  root.render(
    <UIProvider>
      <Box style={{ ...column, width, height: 640 }}>
        <File id="edge" editor={e} file={e.getFile()} {...props} />
      </Box>
    </UIProvider>,
  );
const text = () => r.getPaintedText().join("\n");
const box = (id: string) => {
  const n = r.findByTestId(id);
  assert(n, id);
  const b = r.getElementBounds(n.id);
  assert(b, id);
  return b;
};
const click = (id: string) => {
  const b = box(id);
  r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
};
const settle = () => {
  r.dispatchNativeEvents();
  r.flush();
};
try {
  draw();
  r.nativeSimulateMouseDown(42, 54);
  r.nativeSimulateMouseMove(80, 54, 0);
  r.nativeSimulateMouseUp(80, 54);
  assert(
    e.document.getText(e.selections[0]).startsWith("alpha"),
    "Text drag uses glyph positions",
  );
  const countedClick = (count: number, x = 50, y = 54) => {
    r.flush();
    (
      r as unknown as {
        native: {
          simulateClick(
            x: number,
            y: number,
            button: number,
            modifiers: undefined,
            count: number,
          ): void;
        };
      }
    ).native.simulateClick(x, y, 0, undefined, count);
    settle();
  };
  countedClick(2);
  assert(
    e.selections[0].end.character > e.selections[0].start.character,
    "Double click selects a word",
  );
  countedClick(3);
  assert(
    e.selections[0].end.line > e.selections[0].start.line,
    "Triple click selects a line",
  );
  let selected: any;
  props = {
    enableLineSelection: true,
    onLineSelect: (range) => (selected = range),
  };
  draw();
  r.nativeSimulateClick(22, 54);
  r.nativeSimulateClick(22, 94, 0, "shift");
  assert.equal(selected.start, 1);
  assert.equal(selected.end, 3);
  e = new Editor("file", { name: "columns.txt", contents: "abcd\nefgh\nijkl" });
  props = {};
  draw();
  r.nativeSimulateMouseDown(50, 54, 0, "alt");
  r.nativeSimulateMouseMove(66, 94, 0, "alt");
  r.nativeSimulateMouseUp(66, 94, 0, "alt");
  assert.equal(e.selections.length, 3);
  r.simulateKeystrokes("x");
  assert.equal(e.getText().split("\n").length, 3);
  assert(
    e
      .getText()
      .split("\n")
      .every((line) => line.includes("x")),
  );
  e = new Editor(
    "file",
    { name: "read-only.txt", contents: "abcd" },
    { readOnly: true },
  );
  props = {
    options: {
      theme: {
        ...pierreDark,
        caret: "#ff00ff",
        activeLine: "#00ff00",
        selection: "#00ffff",
      },
      lineHoverHighlight: "disabled",
    },
  };
  draw();
  e.focus();
  e.setSelections([e.caret({ line: 0, character: 2 })]);
  draw();
  r.simulateKeystrokes("ctrl-t");
  r.simulateKeystrokes("x");
  assert.equal(e.getText(), "abcd");
  const reviewCaptures = mkdtempSync(join(tmpdir(), "cherry-review-caret-"));
  try {
    const colors = () => {
      const path = join(reviewCaptures, "frame.png");
      r.captureScreenshot(path);
      const png = PNG.sync.read(readFileSync(path));
      const counts = { caret: 0, active: 0, selected: 0, remote: 0 };
      for (let at = 0; at < png.data.length; at += 4) {
        const [red, green, blue] = png.data.subarray(at, at + 3);
        if (red === 255 && green === 0 && blue === 255) counts.caret++;
        if (red === 0 && green === 255 && blue === 0) counts.active++;
        if (red === 0 && green === 255 && blue === 255) counts.selected++;
        if (red === 255 && green === 255 && blue === 0) counts.remote++;
      }
      return counts;
    };
    assert.equal(
      colors().caret,
      0,
      "Review focus must not paint a local caret",
    );
    assert.equal(
      colors().active,
      0,
      "Review focus must not paint an active line",
    );
    r.nativeSimulateClick(60, 54);
    settle();
    assert.equal(colors().caret, 0, "A review click must not paint a caret");
    r.nativeSimulateMouseDown(42, 54);
    r.nativeSimulateMouseMove(72, 54, 0);
    r.nativeSimulateMouseUp(72, 54);
    settle();
    assert(e.document.getText(e.selections[0]).length > 0);
    assert(colors().selected > 0, "Review text selection stays visible");
    e.setCarets([
      {
        anchor: { line: 0, character: 3 },
        focus: { line: 0, character: 3 },
        metadata: { color: "#ffff00", label: "Ada" },
      },
    ]);
    draw();
    assert(colors().remote > 0, "Remote carets stay visible in review mode");
    e.setCarets([]);
    e.setOptions({ readOnly: false });
    e.setSelections([e.caret({ line: 0, character: 2 })]);
    e.focus();
    draw();
    const editing = colors();
    assert(editing.caret > 0, "Edit mode paints the local caret");
    assert(editing.active > 0, "Edit mode paints the active line");
  } finally {
    rmSync(reviewCaptures, { recursive: true });
  }
  const long = Array.from(
    { length: 200 },
    (_, i) => `row ${i + 1}: ${"word ".repeat(30)}`,
  ).join("\n");
  e = new Editor("file", { name: "anchor.txt", contents: long });
  props = { options: { overflow: "wrap" } };
  draw();
  r.nativeSimulateScrollWheel(800, 350, 0, -1000);
  settle();
  const before = e.view.scrollTop ?? 0;
  const visible = text().match(/row \d+:/)?.[0];
  width = 700;
  draw();
  r.nativeSimulateScrollWheel(500, 350, 0, 0);
  assert(
    text().includes(visible!),
    "Width changes retain the visible source row",
  );
  assert((e.view.scrollTop ?? 0) >= before);
  width = 1000;
  props = { options: { stickyHeader: false } };
  draw();
  r.nativeSimulateScrollWheel(800, 350, 0, -200);
  assert(
    !text().includes("anchor.txt"),
    "Non-sticky headers scroll with the file",
  );
  let own: Editor<any, any> | undefined;
  const file = { name: "retained.txt", contents: "base" };
  const retained = () =>
    root.render(
      <UIProvider>
        <File
          id="retained"
          file={file}
          edit
          editStateKey="native-retained-edge"
          onReady={(editor) => (own = editor)}
        />
      </UIProvider>,
    );
  retained();
  own!.setSelections([own!.caret({ line: 0, character: 4 })]);
  own!.insertText("!");
  root.render(
    <UIProvider>
      <Label>Closed</Label>
    </UIProvider>,
  );
  retained();
  assert.equal(own!.getText(), "base!");
  own!.undo();
  assert.equal(own!.getText(), "base");
  let afterReject = "";
  root.render(
    <UIProvider>
      <FileDiff
        id="hunk"
        oldFile={{ name: "change.txt", contents: "old\n" }}
        newFile={{ name: "change.txt", contents: "new\n" }}
        options={{ showHunkActions: true }}
        onDiffChange={(diff) => (afterReject = diff.additionLines.join(""))}
      />
    </UIProvider>,
  );
  let vp = box("hunk/viewport");
  r.nativeSimulateClick(200, vp.y + 12);
  click("hunk/reject");
  assert.equal(afterReject, "old\n");
  const eofEditor = new Editor("file-diff", {
    name: "eof-diff.txt",
    contents: "new\n",
  });
  root.render(
    <UIProvider>
      <FileDiff
        id="eof-diff"
        oldFile={{ name: "eof-diff.txt", contents: "old\n" }}
        newFile={{ name: "eof-diff.txt", contents: "new\n" }}
        editor={eofEditor}
      />
    </UIProvider>,
  );
  assert(
    !text().split("\n").includes("2"),
    "Diffs trim the final empty line, as the source does",
  );
  eofEditor.focus();
  r.simulateKeystrokes("cmd-down");
  r.simulateKeystrokes("x");
  assert.equal(eofEditor.getText(), "newx\n");
  const initialEditor = new Editor("file", {
      name: "swap.txt",
      contents: "one",
    }),
    replacementEditor = new Editor("file", {
      name: "swap.txt",
      contents: "two",
    });
  const swap = (editor: Editor) =>
    root.render(
      <UIProvider>
        <CodeView
          id="swap"
          items={[{ id: "same", file: editor.getFile(), editor }]}
        />
      </UIProvider>,
    );
  swap(initialEditor);
  swap(replacementEditor);
  const replacementViewport = box("swap/viewport");
  r.nativeSimulateClick(60, replacementViewport.y + 54);
  r.simulateKeystrokes("cmd-right");
  r.simulateKeystrokes("x");
  assert.equal(replacementEditor.getText(), "twox");
  assert.equal(initialEditor.getText(), "one");
  const foldedText =
    Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const foldedEditor = new Editor("file-diff", {
    name: "folded.txt",
    contents: foldedText.replace("line 250", "changed 250"),
  });
  root.render(
    <UIProvider>
      <FileDiff
        id="folded"
        oldFile={{ name: "folded.txt", contents: foldedText }}
        newFile={foldedEditor.getFile()}
        editor={foldedEditor}
      />
    </UIProvider>,
  );
  foldedEditor.setSelections([foldedEditor.caret({ line: 400, character: 0 })]);
  settle();
  assert(text().includes("line 401"), "A cursor jump reveals folded context");
  let across: any;
  root.render(
    <UIProvider>
      <FileDiff
        id="cross"
        oldFile={{ name: "cross.txt", contents: "a\nb\nc\n" }}
        newFile={{ name: "cross.txt", contents: "a\nB\nc\n" }}
        enableLineSelection
        onLineSelect={(range) => (across = range)}
      />
    </UIProvider>,
  );
  const cross = box("cross/viewport");
  r.nativeSimulateMouseDown(22, cross.y + 10);
  r.nativeSimulateMouseMove(522, cross.y + 50, 0);
  r.nativeSimulateMouseUp(522, cross.y + 50);
  assert.equal(across.side, "deletions");
  assert.equal(across.endSide, "additions");
  assert.equal(across.start, 1);
  assert.equal(across.end, 3);
  let accepted = "";
  root.render(
    <UIProvider>
      <CodeView
        id="many"
        items={[
          {
            id: "change",
            oldFile: { name: "change.txt", contents: "old\n" },
            newFile: { name: "change.txt", contents: "new\n" },
            annotations: [
              { lineNumber: 1, side: "additions", metadata: "Note" },
            ],
          },
        ]}
        options={{ showHunkActions: true }}
        onItemDiffChange={(_, diff) => (accepted = diff.deletionLines.join(""))}
      />
    </UIProvider>,
  );
  assert(text().includes("Note"));
  click("change/hunk/0/accept");
  assert.equal(accepted, "new\n");
  const old =
      Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") + "\n",
    next = old.replace("line 50", "changed 50"),
    partial = parsePatchFiles(
      createTwoFilesPatch("partial.txt", "partial.txt", old, next),
    )[0].files[0];
  let loaded = 0;
  root.render(
    <UIProvider>
      <CodeView
        id="partial-many"
        items={[{ id: "partial", fileDiff: partial }]}
        options={{
          loadDiffFiles: async () => {
            loaded++;
            return {
              oldFile: { name: "partial.txt", contents: old },
              newFile: { name: "partial.txt", contents: next },
            };
          },
        }}
      />
    </UIProvider>,
  );
  const header = box("partial/header");
  r.nativeSimulateClick(200, header.y + header.height + 20);
  await Bun.sleep(0);
  settle();
  assert.equal(loaded, 1);
  assert(text().includes("line 0"));
  let controller!: ReadableStreamDefaultController<string>,
    cancelled = false;
  const stream = new ReadableStream<string>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = (follow: boolean) =>
    root.render(
      <UIProvider>
        <FileStream
          id="stream-toggle"
          file={{ name: "stream.txt", contents: "a" }}
          stream={stream}
          follow={follow}
        />
      </UIProvider>,
    );
  streamed(false);
  controller.enqueue("b");
  await Bun.sleep(0);
  streamed(true);
  controller.enqueue("c");
  await Bun.sleep(0);
  settle();
  assert(text().includes("abc"));
  assert(!cancelled, "Changing follow mode must keep the reader");
  root.render(
    <UIProvider>
      <Label>Closed</Label>
    </UIProvider>,
  );
  await Bun.sleep(0);
  assert(cancelled);
  e = new Editor(
    "file",
    { name: "suggest.txt", contents: "x\n".repeat(200) },
    {
      editPrediction: {
        provider: {
          predict: async () => ({
            edits: [
              {
                range: {
                  start: { line: 45, character: 0 },
                  end: { line: 45, character: 1 },
                },
                newText: "hidden",
              },
            ],
            newCursor: { line: 45, character: 6 },
          }),
        },
      },
    },
  );
  props = {};
  draw();
  e.focus();
  await e.requestPrediction();
  draw();
  settle();
  assert(!e.predictionRendered);
  r.simulateKeystrokes("tab");
  assert(
    !e.getText().includes("hidden"),
    "Tab must not accept an unseen suggestion",
  );
  // Deleted-side selections must cover every visual row of wrapped text.
  root.render(
    <UIProvider>
      <Box style={{ ...column, width: 400, height: 400 }}>
        <FileDiff
          id="wrapped-deletion"
          oldFile={{
            name: "wrapped.txt",
            contents:
              "A removed line has enough words to wrap over several visual rows.\n",
          }}
          newFile={{ name: "wrapped.txt", contents: "Replacement\n" }}
          options={{ overflow: "wrap" }}
        />
      </Box>
    </UIProvider>,
  );
  const captureDir = mkdtempSync(join(tmpdir(), "cherry-selection-"));
  try {
    const beforePath = join(captureDir, "before.png");
    r.captureScreenshot(beforePath);
    r.nativeSimulateMouseDown(50, 54);
    r.nativeSimulateMouseMove(140, 94, 0);
    r.nativeSimulateMouseUp(140, 94);
    const afterPath = "docs/evidence/diffs/native-wrapped-selection.png";
    r.captureScreenshot(afterPath);
    const beforePixels = PNG.sync.read(readFileSync(beforePath));
    const afterPixels = PNG.sync.read(readFileSync(afterPath));
    const scale = afterPixels.width / 1000;
    let changed = 0;
    for (let y = 64 * scale; y < 84 * scale; y++)
      for (let x = 50 * scale; x < 190 * scale; x++) {
        const at = (y * afterPixels.width + x) * 4;
        if (
          [0, 1, 2].some(
            (c) => beforePixels.data[at + c] !== afterPixels.data[at + c],
          )
        )
          changed++;
      }
    assert(
      changed > 100 * scale * scale,
      "Selection fills the second wrapped deletion row",
    );
  } finally {
    rmSync(captureDir, { recursive: true });
  }
  const deletionRange = () =>
    JSON.parse(
      (
        r as unknown as {
          native: {
            simulateInputMethod(text: string, marked: boolean): string;
          };
        }
      ).native.simulateInputMethod("ignored read-only input", false),
    ).selected;
  countedClick(2, 80, 54);
  assert.deepEqual(
    deletionRange(),
    [2, 9],
    "Double click selects a deleted word",
  );
  countedClick(3, 80, 54);
  assert.deepEqual(
    deletionRange(),
    [0, 65],
    "Triple click selects the full deleted line",
  );
  console.log(
    "Native gestures, column selection, read-only input, resize anchor, header scrolling, retention, hunk actions, collection hydration, stream cancellation and prediction visibility passed.",
  );
} finally {
  root.unmount();
  e.dispose();
}
