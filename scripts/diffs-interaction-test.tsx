import assert from "node:assert/strict";
import { createTestRoot } from "@gpuix/react/testing";
import {
  UIProvider,
  Box,
  Label,
  Action,
  column,
} from "../src/components/foundation";
import {
  File,
  FileDiff,
  UnresolvedFile,
  Editor,
  pierreDark,
  type CommonCodeProps,
} from "../src/diffs";
process.env.GPUIX_BACKGROUND = "1";
const root = createTestRoot({ width: 1000, height: 640 }),
  r = root.renderer;
let editor = new Editor("file", { name: "test.ts", contents: "hello" }),
  props: Partial<CommonCodeProps> = {};
const draw = () =>
  root.render(
    <UIProvider>
      <File id="test" file={editor.getFile()} editor={editor} {...props} />
    </UIProvider>,
  );
const box = (id: string) => {
  const node = r.findByTestId(id);
  assert(node, `Missing ${id}`);
  const b = r.getElementBounds(node.id);
  assert(b, `No bounds for ${id}`);
  return b;
};
const click = (id: string) => {
  const b = box(id);
  r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
};
const text = () => r.getPaintedText().join("\n");
const ime = (value: string, marked: boolean) => {
  r.flush();
  const result = JSON.parse(
    (
      r as unknown as {
        native: { simulateInputMethod(value: string, marked: boolean): string };
      }
    ).native.simulateInputMethod(value, marked),
  );
  r.dispatchNativeEvents();
  r.flush();
  return result;
};
try {
  draw();
  editor.focus();
  editor.setSelections([
    {
      start: { line: 0, character: 5 },
      end: { line: 0, character: 5 },
      direction: 0,
    },
  ]);
  draw();
  let input = ime("に", true);
  assert.deepEqual(input.marked, [5, 6]);
  assert.equal(editor.getText(), "hello");
  assert(text().includes("helloに"));
  input = ime("日本", true);
  assert.deepEqual(input.marked, [5, 7]);
  assert.equal(editor.getText(), "hello");
  input = ime("日本", false);
  draw();
  assert.equal(input.marked, null);
  assert.equal(editor.getText(), "hello日本");
  editor.undo();
  draw();
  assert.equal(editor.getText(), "hello");
  r.captureScreenshot("docs/evidence/diffs/native-ime.png");
  editor = new Editor("file", {
    name: "wrapped.txt",
    contents: "0123456789".repeat(50) + "\nsecond",
  });
  props = { options: { overflow: "wrap" } };
  draw();
  r.dispatchNativeEvents();
  editor.focus();
  const offsets = editor.cursorOptions.getSoftLineOffsets?.(0);
  assert(
    offsets && offsets.length > 2,
    "GPUI must report wrapped line boundaries",
  );
  editor.setSelections([
    {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 2 },
      direction: 0,
    },
  ]);
  draw();
  r.simulateKeystrokes("down");
  draw();
  assert.equal(editor.selections[0].start.character, offsets[1] + 2);
  r.captureScreenshot("docs/evidence/diffs/native-wrapped-editor.png");
  editor = new Editor("file", {
    name: "notes.ts",
    contents: "one\ntwo\nthree\nfour",
  });
  let clicks = 0;
  props = {
    lineAnnotations: [{ lineNumber: 2, metadata: "review" }],
    renderAnnotation: () => (
      <Box style={{ ...column, padding: 10, gap: 8 }}>
        <Label>Keep this comment with line two.</Label>
        <Action
          id="annotation-control"
          label="Resolve"
          onPress={() => clicks++}
        />
      </Box>
    ),
  };
  draw();
  assert(text().includes("Keep this comment"));
  const first = box("test/annotation/0");
  r.flush();
  assert.deepEqual(box("test/annotation/0"), first);
  click("annotation-control");
  assert.equal(clicks, 1);
  assert.equal(box("test/annotation/0").y, 84);
  r.captureScreenshot("docs/evidence/diffs/native-annotation.png");
  props = {};
  editor = new Editor("file", {
    name: "find.ts",
    contents: "foo food FOO\nfoo 123",
  });
  draw();
  editor.focus();
  r.simulateKeystrokes("cmd-alt-f");
  draw();
  assert(r.findByTestId("test/search/query"));
  click("test/search/query");
  r.simulateKeystrokes("f o o");
  draw();
  assert.equal(editor.search.matches.length, 4);
  click("test/search/wholeWord");
  draw();
  assert.equal(editor.search.matches.length, 3);
  click("test/search/replacement");
  r.simulateKeystrokes("b a r");
  draw();
  click("test/search/replace-all");
  draw();
  assert.equal(editor.getText(), "bar food bar\nbar 123");
  click("test/search/close");
  draw();
  assert(!r.findByTestId("test/search"));
  const before =
    Array.from({ length: 500 }, (_, i) => `const line${i + 1} = ${i};`).join(
      "\n",
    ) + "\n";
  const after = before.replace(
    "const line250 = 249;",
    'const line250 = "changed";',
  );
  root.render(
    <UIProvider>
      <FileDiff
        id="collapsed"
        oldFile={{ name: "large.ts", contents: before }}
        newFile={{ name: "large.ts", contents: after }}
        options={{ showHunkActions: true }}
      />
    </UIProvider>,
  );
  assert(text().includes("unmodified"));
  let viewport = box("collapsed/viewport");
  r.nativeSimulateClick(200, viewport.y + 20);
  r.flush();
  assert(text().includes("const line1"), "Context expansion adds native rows");
  r.captureScreenshot("docs/evidence/diffs/native-expanded.png");
  // Both sides are available on the first frame; a real scroll must keep them aligned.
  root.render(
    <UIProvider>
      <FileDiff
        id="scroll"
        oldFile={{ name: "large.ts", contents: before }}
        newFile={{ name: "large.ts", contents: after }}
        options={{ expandUnchanged: true }}
      />
    </UIProvider>,
  );
  viewport = box("scroll/viewport");
  const start = performance.now();
  for (let i = 0; i < 20; i++) r.nativeSimulateScrollWheel(800, 300, 0, -80);
  const scrollMs = performance.now() - start;
  assert(text().includes("line81"));
  assert.deepEqual(box("scroll/viewport"), viewport);
  r.captureScreenshot("docs/evidence/diffs/native-scroll.png");
  const conflict = {
    name: "merge.ts",
    contents:
      "top\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nbottom\n",
  };
  let resolved = "";
  root.render(
    <UIProvider>
      <UnresolvedFile
        id="merge"
        file={conflict}
        onResolve={(f) => (resolved = f.contents)}
      />
    </UIProvider>,
  );
  click("merge/conflict/0/both");
  r.flush();
  assert.equal(resolved, "top\nours\ntheirs\nbottom\n");
  console.log(
    JSON.stringify({
      native: "passed",
      checks: [
        "IME composition",
        "wrapped caret",
        "native annotation measurement and action",
        "find and replace",
        "context expansion",
        "synchronized scrolling",
        "merge resolution",
      ],
      twentyScrollEventsMs: scrollMs,
    }),
  );
} finally {
  root.unmount();
}
