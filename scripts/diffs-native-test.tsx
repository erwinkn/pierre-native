import assert from "node:assert/strict";
import { createTestRoot } from "@gpuix/react/testing";
import { UIProvider } from "../src/components/foundation";
import { File, FileDiff, Editor, pierreDark, pierreLight } from "../src/diffs";
import { oldFile, newFile } from "../src/diffs/fixtures";
import referenceLayouts from "../tests/fixtures/reference-layouts.json";
process.env.GPUIX_BACKGROUND = "1";
let root = createTestRoot({ width: 1000, height: 600 }),
  r = root.renderer;
const editor = new Editor("file", newFile);
let renderedEditor: Editor<any, any>;
let mode: "split" | "unified" | "editor" = "split",
  theme = pierreDark,
  wrap = false;
const render = () =>
  root.render(
    <UIProvider>
      {mode === "editor" ? (
        <File
          id="test"
          onReady={(controller) => {
            renderedEditor = controller;
          }}
          file={newFile}
          editor={editor}
          options={{ theme, overflow: wrap ? "wrap" : "scroll" }}
        />
      ) : (
        <FileDiff
          id="test"
          onReady={(controller) => {
            renderedEditor = controller;
          }}
          oldFile={oldFile}
          newFile={newFile}
          options={{
            theme,
            diffStyle: mode,
            overflow: wrap ? "wrap" : "scroll",
          }}
        />
      )}
    </UIProvider>,
  );
try {
  render();
  const viewport = r.findByTestId("test/viewport");
  assert(viewport);
  const bounds = r.getElementBounds(viewport.id);
  assert(bounds && bounds.height > 300);
  assert(r.getPaintedText().join("\n").includes("AbortSignal"));
  r.captureScreenshot("docs/evidence/diffs/native-split-dark.png");
  r.flush();
  assert.deepEqual(r.getElementBounds(viewport.id), bounds);
  for (const nextMode of ["split", "unified", "editor"] as const) {
    for (const nextTheme of [pierreDark, pierreLight]) {
      for (const nextWrap of [false, true]) {
        mode = nextMode;
        theme = nextTheme;
        wrap = nextWrap;
        root.unmount();
        root = createTestRoot({ width: wrap ? 400 : 1000, height: 600 });
        r = root.renderer;
        render();
        r.dispatchNativeEvents();
        const name = `${mode}-${theme.mode}${wrap ? "-wrap" : ""}`;
        const expected =
          referenceLayouts[name as keyof typeof referenceLayouts];
        for (const [line, offsets] of Object.entries(expected.softLines)) {
          assert.deepEqual(
            Array.from(
              renderedEditor!.cursorOptions.getSoftLineOffsets?.(
                Number(line),
              ) ?? [],
            ).slice(0, -1),
            offsets.slice(0, -1),
            `${name}: native wrap offsets on line ${Number(line) + 1} match the browser`,
          );
        }
        r.captureScreenshot(
          `docs/evidence/diffs/native-${mode}-${theme.mode}${wrap ? "-wrap" : ""}.png`,
        );
      }
    }
  }
  wrap = false;
  mode = "editor";
  theme = pierreDark;
  render();
  editor.focus();
  r.flush();
  r.simulateKeystrokes("cmd-a");
  render();
  r.simulateKeystrokes("backspace");
  render();
  assert.equal(editor.getText(), "");
  r.simulateKeystrokes("h e l l o");
  render();
  assert.equal(editor.getText(), "hello");
  r.simulateKeystrokes("cmd-z");
  render();
  assert.equal(editor.getText(), "");
  r.simulateKeystrokes("cmd-shift-z");
  render();
  assert.equal(editor.getText(), "hello");
  console.log(
    "Native first frame, layouts, typing, selection, undo, and redo passed.",
  );
} finally {
  root.unmount();
}
