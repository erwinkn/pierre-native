import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { pixelScale } from "./native-pixels";
import { createTestRoot } from "@gpuix/react/testing";
import { PlaygroundApp } from "../src/experiments/diffs/playground/app";
import {
  PlaygroundModel,
  fixtures,
} from "../src/experiments/diffs/playground/model";
process.env.GPUIX_BACKGROUND = "1";
const output = "docs/evidence/playground/interactions";
mkdirSync(output, { recursive: true });
const model = new PlaygroundModel();
const root = createTestRoot({ width: 1440, height: 1100 });
const r = root.renderer;
const frame = () => {
  r.dispatchNativeEvents();
  r.flush();
};
const draw = () => {
  root.render(<PlaygroundApp model={model} />);
  frame();
};
const node = (id: string) => {
  const n = r.findByTestId(id);
  assert(n, id);
  return n;
};
const box = (id: string) => {
  const b = r.getElementBounds(node(id).id);
  assert(b, id);
  return b;
};
const click = (id: string) => {
  const b = box(id);
  r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2);
  frame();
};
const move = (x: number, y: number) => {
  r.nativeSimulateMouseMove(x, y);
  frame();
};
const type = (text: string) => {
  r.simulateKeystrokes(
    [...text].map((c) => (c === " " ? "space" : c)).join(" "),
  );
  frame();
};
const capture = (name: string) => {
  const path = `${output}/${name}.png`;
  r.captureScreenshot(path);
  return PNG.sync.read(readFileSync(path));
};
try {
  draw();
  // The native input and its focus must survive slot insertion above the comment.
  let vp = box("pg/file/viewport");
  move(vp.x + 200, vp.y + 14 * 20 + 10);
  click("pg/add-comment");
  const comment = model.comments.file.at(-1)!;
  const input = `pg/comment/${comment.id}/input`;
  click(input);
  type("draft");
  const inputId = node(input).id;
  for (const line of [13, 10, 8, 3, 1]) {
    move(vp.x + 200, vp.y + line * 20 + 10);
    assert.equal(
      node(input).id,
      inputId,
      "Hover must not remount the draft input",
    );
    assert(r.getPaintedText().join("\n").includes("draft"));
  }
  type(" kept");
  capture("comment-draft");
  click(`pg/comment/${comment.id}/submit`);
  assert.equal(model.comments.file.at(-1)!.body, "draft kept");
  click(`pg/comment/${comment.id}/reply`);
  const reply = `pg/comment/${comment.id}/reply-input`;
  click(reply);
  type("reply");
  const replyId = node(reply).id;
  move(vp.x + 200, vp.y + 10);
  assert.equal(node(reply).id, replyId);
  click(`pg/comment/${comment.id}/reply`);
  assert.deepEqual(model.comments.file.at(-1)!.replies, ["reply"]);
  model.deleteComment(comment.id);
  draw();

  click("pg/line-selection");
  assert(!model.state.enableLineSelection && model.state.enableGutterUtility);
  click("pg/line-selection");
  assert(model.state.enableLineSelection && model.state.enableGutterUtility);
  vp = box("pg/file/viewport");
  // The blue + uses the first 20 points; number clicks select lines separately.
  r.nativeSimulateClick(vp.x + 34, vp.y + 4 * 20 + 10);
  frame();
  assert.equal(model.state.selectedRange?.start, 5);
  assert.equal(box("pg/clear-lines").height, box("pg/find").height);
  // The native bounds recorder excludes the 1-point border on each edge.
  assert.equal(box("pg/clear-lines").height + 2, 36);
  capture("line-selection");
  move(vp.x + 200, vp.y + 6 * 20 + 10);
  click("pg/add-comment");
  assert.equal(model.comments.file.at(-1)!.lineNumber, 7);
  assert.equal(
    model.state.selectedRange?.start,
    5,
    "Adding a comment preserves line selection",
  );
  model.deleteComment(model.comments.file.at(-1)!.id);
  const roundtrip = new PlaygroundModel(model.link());
  assert(
    roundtrip.state.enableLineSelection && roundtrip.state.enableGutterUtility,
  );
  roundtrip.dispose();
  click("pg/clear-lines");
  assert.equal(model.state.selectedRange, null);
  assert(!r.findByTestId("pg/clear-lines"));
  click("pg/line-selection");

  // Find is available in review mode; expanding Replace requests an edit session.
  model.update({ selectionActions: true });
  draw();
  assert(model.file.options.readOnly);
  click("pg/find");
  click("pg/file/search/query");
  type("User");
  click("pg/file/search/caseSensitive");
  for (let i = 0; i < 3; i++) {
    click("pg/file/search/next");
    assert(
      !r.findByTestId("pg/add-to-chat"),
      "Search must not show selection actions",
    );
  }
  const index = model.file.search.index;
  click("pg/file/search/toggle-replace");
  assert.equal(model.file.search.mode, "replace");
  assert(!model.file.options.readOnly);
  assert.equal(model.file.search.text, "User");
  assert.equal(model.file.search.index, index);
  assert(model.file.search.caseSensitive);
  click("pg/file/search/replacement");
  type("Account");
  click("pg/file/search/replace");
  assert.equal((model.file.getText().match(/Account/g) ?? []).length, 1);
  click("pg/file/search/replace-all");
  assert.equal(
    model.file.getText(),
    fixtures.file.contents.replaceAll("User", "Account"),
  );
  capture("replace");
  click("pg/file/search/toggle-replace");
  assert.equal(model.file.search.mode, "find");
  assert(!r.findByTestId("pg/file/search/replacement"));
  assert.equal(model.file.search.replaceText, "Account");
  click("pg/file/search/toggle-replace");
  assert.equal(model.file.search.replaceText, "Account");
  click("pg/file/search/close");
  model.finishEdit(false);
  model.update({ selectionActions: false });
  draw();
  assert.equal(model.file.getText(), fixtures.file.contents);
  click("pg/replace");
  assert(!model.file.options.readOnly, "Toolbar Replace also enters edit mode");
  assert.equal(model.file.search.mode, "replace");
  click("pg/file/search/close");
  model.finishEdit(false);
  draw();

  // Every severity uses Pierre's theme colors, formatting, and text anchor.
  model.beginEdit();
  model.update({ showMarkers: true });
  draw();
  vp = box("pg/file/viewport");
  // Use native text measurement for pointer positions, including tabs and glyph widths.
  const ch = r.measureTextWidths("JetBrains Mono", 13, 400, ["0"])[0];
  const gutter = Math.max(5 * ch + 2, 2 * 13 * 0.6 + 8 + 24);
  for (const marker of model.file.markers) {
    const x = vp.x + gutter + 8 + (marker.start.character + 1) * ch;
    const y = vp.y + marker.start.line * 20 + 10;
    move(x, y);
    const popup = box("pg/file/marker-popover");
    capture("marker-" + marker.severity);
    assert(popup.width >= 180 && popup.width <= 640);
    assert.equal(
      popup.height,
      36,
      "One-line marker message uses 14/20 text and 8-point vertical padding",
    );
    assert(
      Math.abs(popup.x - (vp.x + gutter + 8 + marker.start.character * ch)) < 2,
      "Marker popup starts under the marked text",
    );
    assert(r.getPaintedText().join("\n").includes(marker.message));
    assert(
      !r
        .getPaintedText()
        .join("\n")
        .includes(marker.source + ": " + marker.message),
    );
    const pixels = capture("marker-" + marker.severity);
    const scale = pixelScale(pixels, r.getWindowSize());
    const at =
      (Math.floor((popup.y + 5) * scale) * pixels.width +
        Math.floor((popup.x + 15) * scale)) *
      4;
    // Computed colors from the pinned Pierre playground, independent of our theme resolver.
    const expected = {
      error: [255, 46, 63],
      warning: [255, 212, 82],
      info: [0, 159, 255],
      hint: [157, 157, 157],
    }[marker.severity];
    assert.deepEqual(
      [...pixels.data.slice(at, at + 3)],
      expected,
      "Marker popup color: " + marker.severity,
    );
  }
  move(1, 1);
  model.finishEdit(true);
  model.update({
    viewMode: "diff",
    diffIndicators: "classic",
    selectionActions: false,
  });
  draw();
  capture("diff-classic");
  // In both layouts, the sign needs its own ink interval after the number.
  for (const layout of ["split", "unified"] as const) {
    model.update({ diffStyle: layout });
    draw();
    const pixels = capture("diff-classic-" + layout);
    const scale = pixelScale(pixels, r.getWindowSize());
    const b = box("pg/diff/viewport");
    const paneX = layout === "split" ? b.x + (b.width + 1) / 2 : b.x;
    // Find an added row by the green sign, then check a clear interval before it.
    const signX = paneX + gutter + 16 - 12;
    let rows = 0;
    for (let y = Math.ceil(b.y * scale); y < (b.y + b.height) * scale; y++) {
      const colored = (x: number) => {
        const at = (y * pixels.width + Math.floor(x * scale)) * 4;
        return (
          pixels.data[at + 1] > 120 &&
          pixels.data[at] < 80 &&
          pixels.data[at + 2] < 180
        );
      };
      if (colored(signX + 3)) {
        rows++;
        assert(
          !colored(signX - 3),
          "Line-number ink must not touch the +/- sign",
        );
      }
    }
    assert(rows > 4, "Classic addition indicators paint in " + layout);
  }
  model.update({ disableLineNumbers: true });
  draw();
  capture("diff-classic-no-numbers");
  click("pg/replace");
  assert(!model.diff.options.readOnly);
  click("pg/diff/search/query");
  type("hashPassword");
  click("pg/diff/search/replacement");
  type("hash");
  click("pg/diff/search/replace");
  assert.equal(
    model.diff.getText(),
    fixtures.file.contents.replace("hashPassword", "hash"),
  );
  capture("diff-replace");
  click("pg/undo");
  assert.equal(model.diff.getText(), fixtures.file.contents);
  writeFileSync(
    `${output}/verification.json`,
    JSON.stringify(
      {
        passed: true,
        checks: [
          "comment and reply inputs retain identity, text, and focus during hover",
          "line selection and comment buttons work together and round-trip",
          "find navigation hides selection actions",
          "find/replace expansion preserves query and options",
          "native single and all replacements change text",
          "diff replace and undo",
          "reject restores replaced text",
          "toolbar replace enters edit mode",
          "four marker severities have source formatting and colors",
          "split/unified classic indicators do not touch line-number ink",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Playground comment, marker, search/replace, independent controls, and classic gutter regressions passed.",
  );
} finally {
  root.unmount();
  model.dispose();
}
