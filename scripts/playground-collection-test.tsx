import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { pixelScale } from "./native-pixels";
import { createTestRoot } from "@gpuix/react/testing";
import { PlaygroundApp } from "../src/experiments/diffs/playground/app";
import { PlaygroundModel } from "../src/experiments/diffs/playground/model";
process.env.GPUIX_BACKGROUND = "1";
const output = "docs/evidence/playground/collection-editing";
mkdirSync(output, { recursive: true });
const checks: string[] = [];
for (const { layout, width, mode, suffix } of [
  { layout: "split", width: 1440, mode: "dark", suffix: "" },
  { layout: "unified", width: 1440, mode: "dark", suffix: "" },
  { layout: "unified", width: 1440, mode: "light", suffix: "-light" },
  { layout: "unified", width: 390, mode: "dark", suffix: "-narrow" },
] as const)
  for (const view of ["virtualizer", "virtualizer-element", "codeview"]) {
    const model = new PlaygroundModel(
      `https://diffs.com/playground?view=${view}&layout=${layout}&mode=${mode}`,
    );
    const root = createTestRoot({ width, height: 1000 });
    const r = root.renderer;
    const frame = () => {
      r.dispatchNativeEvents();
      r.flush();
    };
    const draw = () => {
      root.render(<PlaygroundApp model={model} systemMode={mode} />);
      frame();
    };
    const box = (id: string) => {
      const node = r.findByTestId(id);
      assert(node, id);
      const bounds = r.getElementBounds(node.id);
      assert(bounds, id);
      return bounds;
    };
    const click = (id: string) => {
      const b = box(id);
      r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
      frame();
    };
    const key = (keys: string) => {
      r.simulateKeystrokes(keys);
      frame();
    };
    const oldSide = (id: string) => {
      const vp = box("pg/collection/viewport"),
        header = box(id + "/header");
      r.nativeSimulateClick(vp.x + 120, header.y + header.height + 10);
      frame();
    };
    const checkHeader = (id: string, editing: boolean) => {
      // GPUI's absolute bounds recorder is inside the control's 1-point border.
      const button = (id: string) => {
        const b = box(id);
        return {
          x: b.x - 1,
          y: b.y - 1,
          width: b.width + 2,
          height: b.height + 2,
        };
      };
      const viewport = box("pg/collection/viewport"),
        header = box(id + "/header"),
        action = button((editing ? "pg/accept-edit/" : "pg/start-edit/") + id);
      assert.equal(header.x, viewport.x, "Header starts at the viewport edge");
      assert.equal(header.width, viewport.width, "Header fills the viewport");
      assert.equal(header.height, 44);
      assert.equal(action.height, 26);
      assert.equal(action.y + action.height / 2, header.y + header.height / 2);
      assert.equal(header.x + header.width - action.x - action.width, 8);
      if (editing) {
        const cancel = button("pg/reject-edit/" + id);
        assert.equal(
          action.x - cancel.x - cancel.width,
          6,
          "Cancel precedes Save",
        );
        assert.equal(cancel.height, action.height);
        const labels = r.getPaintedText();
        assert(labels.includes("Cancel") && labels.includes("Save"));
        assert(!labels.includes("Accept") && !labels.includes("Reject"));
      }
      if (id !== "file:README.md") {
        const counts = box(id + "/counts");
        const firstAction = editing ? button("pg/reject-edit/" + id) : action;
        assert.equal(firstAction.x - counts.x - counts.width, 8);
      }
    };
    try {
      draw();
      const id = view === "codeview" ? "file:README.md" : "diff-0";
      const editor = model.collection.get(id)!;
      const before = editor.getText();
      checkHeader(id, false);
      if (layout === "split" && view !== "codeview") oldSide(id);
      click("pg/start-edit/" + id);
      assert.equal(editor.options.readOnly, false);
      checkHeader(id, true);
      key("x");
      assert(
        editor.getText() !== before,
        "Edit must focus the writable document after inspecting the old side: " +
          view,
      );
      const accepted = editor.getText();
      key("cmd-z");
      assert.equal(editor.getText(), before);
      key("cmd-shift-z");
      assert.equal(editor.getText(), accepted);
      click("pg/accept-edit/" + id);
      key("q");
      assert.equal(
        editor.getText(),
        accepted,
        "Accepted document returns to review mode",
      );
      click("pg/start-edit/" + id);
      key("t");
      click("pg/reject-edit/" + id);
      assert.equal(editor.getText(), accepted);
      click(id + "/collapse");
      const scrollBounds = box("pg/collection/viewport");
      r.nativeSimulateScrollWheel(
        scrollBounds.x + scrollBounds.width / 2,
        scrollBounds.y + 150,
        0,
        -80,
      );
      frame();

      const secondId = view === "codeview" ? "diff:api/resources.ts" : "diff-1";
      const second = model.collection.get(secondId)!;
      const secondBefore = second.getText();
      const viewportBefore = box("pg/collection/viewport");
      const headerBefore = box(secondId + "/header");
      checkHeader(secondId, false);
      // Do not click the second document first. Its Edit button must activate it.
      click("pg/start-edit/" + secondId);
      assert.equal(second.options.readOnly, false);
      checkHeader(secondId, true);
      assert.deepEqual(box("pg/collection/viewport"), viewportBefore);
      assert.deepEqual(
        {
          y: box(secondId + "/header").y,
          height: box(secondId + "/header").height,
        },
        { y: headerBefore.y, height: headerBefore.height },
        "Edit must preserve the shared scroll position",
      );
      key("z");
      assert(
        second.getText() !== secondBefore,
        "Edit must focus a later file: " + view,
      );
      assert.equal(
        editor.getText(),
        accepted,
        "Typing must not change another file",
      );
      const edited = second.getText();
      key("cmd-z");
      assert.equal(second.getText(), secondBefore);
      key("cmd-shift-z");
      assert.equal(second.getText(), edited);
      if (layout === "split") {
        oldSide(secondId);
        key("q");
        assert.equal(
          second.getText(),
          edited,
          "Old-side pointer selection stays read-only after programmatic focus",
        );
        second.focus();
        draw();
        key("p");
        assert(
          second.getText() !== edited,
          "Explicit focus returns input to the new side",
        );
      }
      r.nativeSimulateMouseMove(50, 50);
      frame();
      const path = `${output}/${view}-${layout}${suffix}.png`;
      r.captureScreenshot(path);
      const pixels = PNG.sync.read(readFileSync(path));
      const scale = pixelScale(pixels, r.getWindowSize());
      const save = box("pg/accept-edit/" + secondId);
      const at =
        (Math.floor((save.y + 4) * scale) * pixels.width +
          Math.floor((save.x + save.width / 2) * scale)) *
        4;
      assert(
        pixels.data[at + 2] > pixels.data[at] + 30,
        "Save has a blue fill in the rendered header",
      );
      click("pg/reject-edit/" + secondId);
      assert.equal(second.getText(), secondBefore);
      assert.equal(editor.getText(), accepted);
      assert.equal(second.options.readOnly, true);
      checks.push(
        `${view}/${layout}/${mode}/${width}: full-width first and sticky headers, right-aligned counts, Cancel/blue Save, first and later file Edit, old-side focus, native typing, undo/redo, save/cancel, file isolation, and scroll after cancellation`,
      );
    } finally {
      root.unmount();
      model.dispose();
    }
  }
writeFileSync(
  `${output}/verification.json`,
  JSON.stringify({ passed: true, checks }, null, 2) + "\n",
);
console.log(
  "All three collection views pass native editing in split and unified layouts.",
);
