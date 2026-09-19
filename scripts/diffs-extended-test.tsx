import assert from "node:assert/strict";
import { createTestRoot } from "@gpuix/react/testing";
import { createTwoFilesPatch } from "diff";
import { UIProvider, Label } from "../src/components/foundation";
import {
  File,
  FileDiff,
  FileStream,
  CodeView,
  Editor,
  parsePatchFiles,
  pierreDark,
  type CommonCodeProps,
} from "../src/diffs";
process.env.GPUIX_BACKGROUND = "1";
const root = createTestRoot({ width: 1000, height: 640 }),
  r = root.renderer;
let editor = new Editor("file", { name: "eof.txt", contents: "one\n" }),
  props: Partial<CommonCodeProps> = {};
const draw = () =>
  root.render(
    <UIProvider>
      <File id="test" file={editor.getFile()} editor={editor} {...props} />
    </UIProvider>,
  );
const box = (id: string) => {
  const n = r.findByTestId(id);
  assert(n, `Missing ${id}`);
  const b = r.getElementBounds(n.id);
  assert(b);
  return b;
};
const text = () => r.getPaintedText().join("\n");
const frame = () => {
  r.dispatchNativeEvents();
  r.flush();
};
try {
  draw();
  const accessible = Object.values(r.getA11yTree().nodes ?? {}).find(
    (n: any) => n.aria?.label === "View eof.txt",
  ) as any;
  assert.equal(accessible?.aria.value, "one\n");
  editor.focus();
  r.simulateKeystrokes("cmd-down");
  r.simulateKeystrokes("x");
  draw();
  assert.equal(editor.getText(), "one\nx");
  assert(text().includes("x"));
  editor = new Editor("file", { name: "wide.txt", contents: "x".repeat(500) });
  draw();
  frame();
  editor.focus();
  r.simulateKeystrokes("cmd-right");
  r.simulateKeystrokes("z");
  draw();
  assert.equal(editor.getText().at(-1), "z");
  r.nativeSimulateScrollWheel(800, 80, 0, -1);
  assert(
    editor.view.scrollLeft > 2000,
    "The caret must reveal the end of a long line",
  );
  editor = new Editor("file", {
    name: "marker.ts",
    contents: "const broken = 1;\nnext();\n",
  });
  editor.setMarkers([
    {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 12 },
      severity: "error",
      message: "Unknown symbol",
      source: "Test",
    },
  ]);
  editor.setCarets([
    {
      anchor: { line: 1, character: 2 },
      focus: { line: 1, character: 2 },
      metadata: { color: "#ee82ee", label: "Ada" },
    },
  ]);
  props = {
    renderSelectionAction: ({ text }) => <Label>{`Selected: ${text}`}</Label>,
  };
  draw();
  r.nativeSimulateMouseMove(105, 54);
  frame();
  assert(
    text().includes("Unknown symbol"),
    "Marker hover must expose its message",
  );
  assert(text().includes("Ada"));
  editor.setSelections([
    {
      start: { line: 0, character: 6 },
      end: { line: 0, character: 12 },
      direction: 1,
    },
  ]);
  draw();
  assert(text().includes("Selected: broken"));
  r.captureScreenshot("docs/evidence/diffs/native-marker.png");
  props = {};
  editor = new Editor(
    "file",
    { name: "prediction.ts", contents: "const x = 1;\n" },
    {
      editPrediction: {
        provider: {
          predict: async () => ({
            edits: [
              {
                range: {
                  start: { line: 0, character: 10 },
                  end: { line: 0, character: 11 },
                },
                newText: "100",
              },
            ],
            newCursor: { line: 0, character: 13 },
          }),
        },
      },
    },
  );
  draw();
  editor.focus();
  await editor.requestPrediction();
  draw();
  assert.equal(editor.getText(), "const x = 1;\n");
  assert(
    text().includes("100"),
    "Prediction must be in the native painted text",
  );
  r.captureScreenshot("docs/evidence/diffs/native-prediction.png");
  r.simulateKeystrokes("tab");
  draw();
  assert.equal(editor.getText(), "const x = 100;\n");
  r.simulateKeystrokes("cmd-z");
  draw();
  assert.equal(editor.getText(), "const x = 1;\n");
  const first = new Editor("file", { name: "first.txt", contents: "first\n" }),
    second = new Editor("file", { name: "second.txt", contents: "second\n" });
  const items = [
    { id: "first", file: first.getFile(), editor: first },
    { id: "second", file: second.getFile(), editor: second },
  ];
  const collection = () =>
    root.render(
      <UIProvider>
        <CodeView id="collection" items={items} />
      </UIProvider>,
    );
  collection();
  assert(text().includes("first.txt") && text().includes("second.txt"));
  const header = box("second/header");
  assert(header.y >= 84 && header.y < 200);
  const stable = box("collection/viewport");
  r.nativeSimulateClick(90, header.y + 54);
  r.simulateKeystrokes("cmd-right");
  r.simulateKeystrokes("x");
  collection();
  assert.equal(first.getText(), "first\n");
  assert.equal(second.getText(), "secondx\n");
  assert.deepEqual(box("collection/viewport"), stable);
  r.captureScreenshot("docs/evidence/diffs/native-collection.png");
  let producer!: ReadableStreamDefaultController<string>,
    closed = false;
  const stream = new ReadableStream<string>({
    start(c) {
      producer = c;
    },
  });
  root.render(
    <UIProvider>
      <FileStream
        id="stream"
        file={{ name: "stream.ts", contents: "const x = " }}
        stream={stream}
        onStreamClose={() => (closed = true)}
      />
    </UIProvider>,
  );
  assert(text().includes("const x = "));
  producer.enqueue("1;\n");
  await new Promise((resolve) => setTimeout(resolve, 0));
  frame();
  assert(text().includes("const x = 1;"));
  producer.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(closed);
  const before =
      Array.from({ length: 90 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
    after = before.replace("line 50", "changed 50");
  const partial = parsePatchFiles(
    createTwoFilesPatch("partial.txt", "partial.txt", before, after),
  ).flatMap((p) => p.files)[0];
  assert(partial.isPartial);
  let calls = 0;
  root.render(
    <UIProvider>
      <FileDiff
        id="partial"
        fileDiff={partial}
        options={{
          loadDiffFiles: async () => {
            calls++;
            return {
              oldFile: { name: "partial.txt", contents: before },
              newFile: { name: "partial.txt", contents: after },
            };
          },
        }}
      />
    </UIProvider>,
  );
  const vp = box("partial/viewport");
  r.nativeSimulateClick(200, vp.y + 20);
  await new Promise((resolve) => setTimeout(resolve, 0));
  frame();
  assert.equal(calls, 1);
  assert(text().includes("changed 50"));
  r.nativeSimulateClick(200, vp.y + 20);
  frame();
  assert(
    text().includes("line 1"),
    "Loaded context must keep the complete source document",
  );
  console.log(
    "Native EOF, horizontal caret, markers, remote carets, selection actions, inline prediction, continuous file editing, stream and partial hydration passed.",
  );
} finally {
  root.unmount();
  editor.dispose();
}
