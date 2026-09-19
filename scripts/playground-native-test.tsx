import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { pixelScale } from "./native-pixels";
import { formatHex } from "culori";
import { createTestRoot } from "@gpuix/react/testing";
import { PlaygroundApp } from "../src/experiments/diffs/playground/app";
import {
  PlaygroundModel,
  fixtures,
} from "../src/experiments/diffs/playground/model";
import {
  codeThemes,
  LIGHT_THEMES,
  DARK_THEMES,
} from "../src/experiments/diffs/playground/theme";
process.env.GPUIX_BACKGROUND = "1";
const model = new PlaygroundModel();
let root = createTestRoot({ width: 1440, height: 1000 }),
  r = root.renderer;
const draw = () => {
  root.render(<PlaygroundApp model={model} />);
  r.dispatchNativeEvents();
  r.flush();
};
const box = (id: string) => {
  const node = r.findByTestId(id);
  assert(node, id);
  const bounds = r.getElementBounds(node.id);
  assert(bounds, id + " bounds");
  return bounds;
};
const click = (id: string) => {
  const b = box(id);
  r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
  r.dispatchNativeEvents();
  r.flush();
};
const choose = (id: string, value: string) => {
  click(id);
  click(id + "/menu/item/" + value);
};
const capture = (name: string) =>
  r.captureScreenshot("docs/evidence/playground/native-" + name + ".png");
try {
  draw();
  assert(r.getPaintedText().includes("api/users.ts"));
  const first = box("pg/content");
  const window = r.getWindowSize();
  assert(
    window.width >= 1280,
    "Desktop viewport reaches the full controls layout",
  );
  assert.equal(
    first.x,
    (window.width - first.width) / 2,
    "Content is centered",
  );
  assert.equal(first.y, box("pg/controls").y + box("pg/controls").height + 24);
  assert(!r.findByTestId("pg/header"));
  assert.equal(first.width, 1240);
  capture("file-dark");
  r.nativeSimulateMouseMove(1, 1);
  r.dispatchNativeEvents();
  r.flush();
  r.captureScreenshot("docs/evidence/playground/hover-clear.png");
  let hoverViewport = box("pg/file/viewport");
  const hoverY = hoverViewport.y + 12 * 20;
  r.nativeSimulateMouseMove(hoverViewport.x + 200, hoverY + 10);
  r.dispatchNativeEvents();
  r.flush();
  const utility = box("pg/add-comment");
  assert.equal(utility.width, 20);
  assert.equal(utility.height, 20);
  assert.equal(utility.x, hoverViewport.x);
  assert.equal(utility.y, hoverY);
  capture("hover-fixed");
  const clearPixels = PNG.sync.read(
    readFileSync("docs/evidence/playground/hover-clear.png"),
  );
  const hoverPixels = PNG.sync.read(
    readFileSync("docs/evidence/playground/native-hover-fixed.png"),
  );
  const scale = pixelScale(clearPixels, window);
  assert.equal(pixelScale(hoverPixels, window), scale);
  for (
    let y = Math.floor(hoverViewport.y * scale);
    y < (hoverViewport.y + hoverViewport.height) * scale;
    y++
  ) {
    const from =
      (y * clearPixels.width + Math.ceil((hoverViewport.x + 22) * scale)) * 4;
    const to =
      (y * clearPixels.width + Math.floor((hoverViewport.x + 600) * scale)) * 4;
    assert.deepEqual(
      hoverPixels.data.subarray(from, to),
      clearPixels.data.subarray(from, to),
      "Hover preserves every line number and code pixel, without moving later rows",
    );
  }
  r.nativeSimulateMouseMove(1, 1);
  r.dispatchNativeEvents();
  r.flush();

  r.flush();
  assert.deepEqual(box("pg/content"), first, "First and next frame agree");
  for (const [id, key] of [
    ["pg/background", "disableBackground"],
    ["pg/line-numbers", "disableLineNumbers"],
    ["pg/annotations", "showAnnotations"],
  ] as const) {
    const before = model.state[key];
    click(id);
    assert.equal(model.state[key], !before);
    click(id);
  }
  click("pg/wrap");
  assert.equal(model.state.overflow, "scroll");
  click("pg/wrap");
  for (const mode of ["light", "dark"] as const) {
    click("pg/color/" + mode);
    for (const name of mode === "light" ? LIGHT_THEMES : DARK_THEMES) {
      choose("pg/" + mode + "-theme", name);
      r.captureScreenshot("docs/evidence/playground/theme-check.png");
      const pixels = PNG.sync.read(
        readFileSync("docs/evidence/playground/theme-check.png"),
      );
      const viewport = box("pg/file/viewport");
      const at =
        (Math.floor((viewport.y + 6) * scale) * pixels.width +
          Math.floor((viewport.x + viewport.width - 30) * scale)) *
        4;
      const rgb = formatHex(codeThemes[name].background)!
        .slice(1)
        .match(/../g)!
        .slice(0, 3)
        .map((n) => parseInt(n, 16));
      assert.deepEqual(
        [...pixels.data.slice(at, at + 3)],
        rgb,
        "Native theme background: " + name,
      );
    }
    choose("pg/" + mode + "-theme", "pierre-" + mode);
  }
  for (const value of ["word", "char", "none", "word-alt"])
    choose("pg/inline", value);
  for (const value of ["line-info-basic", "simple", "metadata", "line-info"])
    choose("pg/hunks", value);
  click("pg/line-selection");
  assert(!model.state.enableLineSelection && model.state.enableGutterUtility);
  click("pg/line-selection");
  assert(model.state.enableLineSelection && model.state.enableGutterUtility);
  click("pg/comment-buttons");
  assert(model.state.enableLineSelection && !model.state.enableGutterUtility);
  click("pg/line-selection");
  click("pg/comment-buttons");
  for (const value of ["classic", "none", "bars"])
    click("pg/indicators/" + value);
  click("pg/start-edit");
  assert(!model.file.options.readOnly);
  let vp = box("pg/file/viewport");
  r.nativeSimulateClick(vp.x + 80, vp.y + 10);
  r.simulateKeystrokes("cmd-a x");
  draw();
  assert.equal(model.file.getText(), "x");
  click("pg/undo");
  assert.equal(model.file.getText(), fixtures.file.contents);
  click("pg/markers");
  assert.equal(model.file.markers.length, 4);
  capture("file-edit-markers");
  click("pg/find");
  assert(r.findByTestId("pg/file/search/query"));
  click("pg/file/search/close");
  choose("pg/hover", "both");
  vp = box("pg/file/viewport");
  r.nativeSimulateMouseMove(1, 1);
  r.dispatchNativeEvents();
  r.flush();
  const beforePath = "docs/evidence/playground/native-hover-before.png";
  r.captureScreenshot(beforePath);
  r.nativeSimulateMouseMove(vp.x + 150, vp.y + 10);
  r.dispatchNativeEvents();
  r.flush();
  capture("hover");
  const a = PNG.sync.read(readFileSync(beforePath));
  const b = PNG.sync.read(
    readFileSync("docs/evidence/playground/native-hover.png"),
  );
  const at =
    (Math.floor((box("pg/add-comment").y + 5) * scale) * b.width +
      Math.floor((vp.x + 600) * scale)) *
    4;
  assert.notDeepEqual(
    [...a.data.slice(at, at + 3)],
    [...b.data.slice(at, at + 3)],
    "Hover control changes the native row paint",
  );
  r.nativeSimulateMouseMove(vp.x + 15, vp.y + 20 * 8 + 10);
  r.dispatchNativeEvents();
  r.flush();
  click("pg/add-comment");
  const note = model.comments.file.at(-1)!;
  assert(note.draft);
  click("pg/comment/" + note.id + "/input");
  r.simulateKeystrokes("r a t e s");
  click("pg/comment/" + note.id + "/submit");
  assert.equal(model.comments.file.at(-1)!.body, "rates");
  const line = model.comments.file.at(-1)!.lineNumber;
  model.file.setSelections([model.file.caret({ line: 0, character: 0 })]);
  model.file.insertText("// prefix\n");
  draw();
  assert.equal(
    model.comments.file.at(-1)!.lineNumber,
    line + 1,
    "Comment follows a structural edit",
  );
  model.file.undo();
  draw();
  assert.equal(
    model.comments.file.at(-1)!.lineNumber,
    line,
    "Comment follows undo",
  );
  capture("comment");
  click("pg/comment/" + note.id + "/resolve");
  assert(model.comments.file.at(-1)!.resolved);
  click("pg/accept-edit");
  assert(model.file.options.readOnly);
  choose("pg/dark-theme", "catppuccin-mocha");
  assert.equal(model.state.darkTheme, "catppuccin-mocha");
  capture("theme-mocha");
  choose("pg/dark-theme", "pierre-dark");
  click("pg/color/light");
  capture("file-light");
  const lightImage = PNG.sync.read(
    readFileSync("docs/evidence/playground/native-file-light.png"),
  );
  assert.deepEqual(
    [...lightImage.data.slice(0, 3)],
    [10, 10, 10],
    "Editor color mode preserves page appearance",
  );
  click("pg/color/dark");
  choose("pg/view", "diff");
  capture("diff-split");
  const splitImage = PNG.sync.read(
    readFileSync("docs/evidence/playground/native-diff-split.png"),
  );
  const noteBounds = box("pg/comment/0");
  const fillAt =
    (Math.floor((noteBounds.y + 20) * scale) * splitImage.width +
      Math.floor(200 * scale)) *
    4;
  assert.deepEqual(
    [...splitImage.data.slice(fillAt, fillAt + 3)],
    [
      ...Buffer.from(
        formatHex(codeThemes["pierre-dark"].context)!.slice(1),
        "hex",
      ),
    ],
    "Annotation background spans the empty diff side",
  );

  click("pg/layout/unified");
  capture("diff-unified");
  click("pg/layout/split");
  choose("pg/examples", "carets");
  capture("carets-labels");
  const labels = PNG.sync.read(
    readFileSync("docs/evidence/playground/native-carets-labels.png"),
  );
  for (const rgb of [
    [124, 58, 237],
    [194, 65, 12],
  ]) {
    let pixels = 0;
    for (let at = 0; at < labels.data.length; at += 4)
      if (rgb.every((value, c) => Math.abs(labels.data[at + c] - value) < 3))
        pixels++;
    assert(
      pixels / (scale * scale) > 250,
      "Remote cursor badge paints more than 250 square logical points",
    );
  }

  vp = box("pg/peer/0/viewport");
  model.peers[0].setSelections([
    model.peers[0].caret({ line: 0, character: 0 }),
  ]);
  draw();
  r.nativeSimulateClick(vp.x + 80, vp.y + 30, 0, "cmd");
  draw();
  assert.equal(
    model.peers[0].selections.length,
    2,
    "Cmd-click adds a native caret",
  );
  r.simulateKeystrokes("x");
  draw();
  assert.equal(model.peers[0].getText(), model.peers[1].getText());
  capture("carets");
  const peer2 = box("pg/peer/1/viewport");
  r.nativeSimulateClick(peer2.x + 90, peer2.y + 70);
  draw();
  assert.equal(
    model.activePeer,
    1,
    "Native focus selects the second collaborator",
  );
  assert.equal(
    model.peers[0].focused,
    false,
    "Native blur clears the first collaborator",
  );
  const beforePeer2 = model.peers[1].getText();
  r.simulateKeystrokes("y");
  draw();
  click("pg/undo");
  assert.equal(model.peers[1].getText(), beforePeer2);
  assert.equal(model.peers[0].getText(), beforePeer2);
  choose("pg/examples", "selection");
  model.selection.setSelections([
    {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
      direction: 1,
    },
  ]);
  draw();
  click("pg/add-to-chat");
  assert.equal(model.snippets.length, 1);
  assert(r.getPaintedText().some((t) => t.includes("banner.ts")));
  capture("selection-chat");
  choose("pg/examples", "find");
  assert(r.findByTestId("pg/find-editor/search/query"));
  model.find.search.mode = "replace";
  model.find.updateSearch({ text: "user", replaceText: "member" });
  draw();
  click("pg/find-editor/search/replace-all");
  assert(!model.find.getText().toLowerCase().includes("user"));
  capture("find-replace");
  choose("pg/examples", "history");
  assert.equal(model.historyStep, 7);
  click("pg/history/start");
  assert.equal(model.historyStep, 0);
  click("pg/history/step/3");
  assert.equal(model.historyStep, 3);
  click("pg/history/end");
  assert.equal(model.historyStep, 7);
  capture("history");
  choose("pg/examples", "shortcuts");
  model.update({ shortcutQuery: "undo" });
  draw();
  assert(r.getPaintedText().includes("1 of 33 bindings"));
  model.update({ shortcutQuery: "" });
  draw();
  capture("shortcuts");
  click("pg/shortcut-mode");
  assert(r.findByTestId("pg/keymap-editor/viewport"));
  model.keymap.replaceDocument({
    name: "keymap.json",
    contents: '[{"bindings":{"ctrl+j":"insertBlankLine"}}]',
  });
  draw();
  click("pg/apply-keymap");
  assert.equal(model.state.keymapError, "");
  capture("keymap");
  for (const viewMode of [
    "virtualizer",
    "virtualizer-element",
    "codeview",
  ] as const) {
    choose("pg/view", viewMode);
    assert(r.findByTestId("pg/collection/viewport"));
    const v = box("pg/collection/viewport");
    r.nativeSimulateScrollWheel(v.x + 200, v.y + 200, 0, -1200);
    r.dispatchNativeEvents();
    r.flush();
    capture(viewMode);
  }
  model.update({
    viewMode: "file",
    example: "playground",
    notice: "",
    lineHoverHighlight: "disabled",
    showMarkers: false,
  });
  root.unmount();
  root = createTestRoot({ width: 390, height: 844 });
  r = root.renderer;
  draw();
  assert(r.findByTestId("pg/open-options"));
  capture("mobile");
  click("pg/open-options");
  assert(r.findByTestId("pg/options-dialog"));
  capture("mobile-options");
  click("pg/options-close");
  model.setExample("find");
  draw();
  assert(box("pg/find-editor/search/query").width <= 350);
  capture("mobile-find");
  for (const width of [390, 768, 1024]) {
    root.unmount();
    root = createTestRoot({ width, height: 844 });
    r = root.renderer;
    for (const example of [
      "carets",
      "selection",
      "history",
      "shortcuts",
      "playground",
    ] as const) {
      model.update({ example, selectionActions: example === "playground" });
      draw();
      assert(
        box("pg/content").height > 100,
        `${width}: ${example} usable content`,
      );
      if (example === "selection" || example === "playground") {
        const chat = box("pg/chat");
        assert(chat.x >= 0 && chat.x + chat.width <= width, "Chat fits window");
        const editor = box(
          example === "selection"
            ? "pg/selection-editor/viewport"
            : "pg/file/viewport",
        );
        assert(
          editor.width > 250 && editor.height > 100,
          "Chat leaves a usable editor",
        );
      }
      if (width === 390) capture("mobile-" + example);
    }
  }
  console.log(
    "Native playground controls, editing, hover, comments, themes, all examples, collections, and narrow layouts passed.",
  );
} finally {
  root.unmount();
  model.dispose();
}
