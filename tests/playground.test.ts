import { test, expect } from "bun:test";
import {
  PlaygroundModel,
  fixtures,
} from "../src/experiments/diffs/playground/model";
test("playground options round-trip through the comparison link", () => {
  const model = new PlaygroundModel();
  model.update({
    diffStyle: "unified",
    darkTheme: "github-dark",
    disableLineNumbers: true,
    lineHoverHighlight: "both",
    example: "history",
  });
  const other = new PlaygroundModel(model.link());
  expect(other.state.diffStyle).toBe("unified");
  expect(other.state.darkTheme).toBe("github-dark");
  expect(other.state.disableLineNumbers).toBe(true);
  expect(other.state.example).toBe("history");
  expect(other.state.editPrediction).toBe(false);
  model.dispose();
  other.dispose();
});
test("edit acceptance and rejection preserve independent file sessions", () => {
  const model = new PlaygroundModel();
  model.beginEdit();
  model.file.insertText("temporary");
  model.finishEdit(false);
  expect(model.file.getText()).toBe(fixtures.file.contents);
  model.beginEdit();
  model.file.insertText("// accepted\n");
  model.finishEdit(true);
  expect(model.file.getText()).toStartWith("// accepted\n");
  expect(model.file.options.readOnly).toBe(true);
  model.update({ viewMode: "diff" });
  expect(model.diff.getText()).toBe(fixtures.file.contents);
  model.dispose();
});
test("both collaborators mirror edits and retain remote carets", () => {
  const model = new PlaygroundModel(),
    [a, b] = model.peers;
  a.setSelections([a.caret({ line: 0, character: 0 })]);
  a.insertText("// shared\n");
  expect(b.getText()).toBe(a.getText());
  b.setSelections([b.caret({ line: 2, character: 0 })]);
  b.insertText("  ");
  expect(a.getText()).toBe(b.getText());
  expect(a.carets[0].metadata.label).toBe("Mark");
  expect(b.carets[0].metadata.label).toBe("Amadeus");
  a.undo();
  expect(a.getText()).toBe(b.getText());
  model.dispose();
});
test("all seven source refactor steps exist before the first frame", () => {
  const model = new PlaygroundModel();
  expect(model.historyStep).toBe(7);
  model.jumpHistory(0);
  expect(model.history.getText()).toBe(fixtures.historyFile.contents);
  expect(model.historyStep).toBe(0);
  model.jumpHistory(3);
  expect(model.history.getText()).toContain("items.reduce");
  expect(model.history.getText()).toContain("var discount");
  model.jumpHistory(7);
  expect(model.history.getText()).toContain("Math.round");
  model.history.insertText("custom");
  expect(model.historyStep).toBe(-1);
  model.setExample("history");
  model.resetCurrent();
  expect(model.historyStep).toBe(7);
  model.dispose();
});
test("snippet actions retain source location and support removal", () => {
  const model = new PlaygroundModel();
  model.selection.setSelections([
    {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
      direction: 1,
    },
  ]);
  model.addSnippet(model.selection);
  expect(model.snippets[0]).toMatchObject({
    start: 1,
    end: 1,
    filename: "banner.ts",
  });
  expect(model.snippets[0].text).toContain("Welcome back");
  model.removeSnippet(model.snippets[0].id);
  expect(model.snippets).toHaveLength(0);
  model.dispose();
});
test("keymap validation leaves the prior bindings active on error", () => {
  const model = new PlaygroundModel();
  expect(model.shortcutRows).toHaveLength(33);
  model.update({ shortcutQuery: "  CMD  Z  " });
  expect(model.shortcutRows[0]?.command).toBe("undo");
  model.update({ shortcutQuery: "undo" });
  expect(model.shortcutRows).toHaveLength(1);
  model.keymap.replaceDocument({
    name: "keymap.json",
    contents: '[{"bindings":{"ctrl+j":"insertBlankLine"}}]',
  });
  model.applyKeymap();
  expect(model.state.keymapError).toBe("");
  model.beginEdit();
  const before = model.file.getText();
  model.file.handleNativeEvent({ kind: "key", key: "j", ctrl: true });
  expect(model.file.getText()).not.toBe(before);
  model.keymap.replaceDocument({
    name: "keymap.json",
    contents: '[{"bindings":{"Tab":"inventedCommand"}}]',
  });
  model.applyKeymap();
  expect(model.state.keymapError).not.toBe("");
  expect(model.file.options.keymap?.[0].bindings["ctrl+j"]).toBe(
    "insertBlankLine",
  );
  model.dispose();
});

test("reject restores comment positions and each collection file independently", () => {
  const model = new PlaygroundModel();
  model.addComment(9, "additions");
  model.file.setLineAnnotations(
    model.comments.file.map((c) => ({ lineNumber: c.lineNumber, metadata: c })),
  );
  model.beginEdit();
  model.file.insertText("// added\n");
  expect(model.comments.file[0].lineNumber).toBe(10);
  model.finishEdit(false);
  expect(model.comments.file[0].lineNumber).toBe(9);
  const a = model.collectionEditor(
    "a",
    { name: "a.ts", contents: "const a = 1;" },
    false,
  );
  const b = model.collectionEditor(
    "b",
    { name: "b.ts", contents: "const b = 2;" },
    false,
  );
  model.beginEdit(a);
  a.insertText("// a\n");
  model.beginEdit(b);
  b.insertText("// b\n");
  model.finishEdit(false, a);
  model.finishEdit(true, b);
  expect(a.getText()).toBe("const a = 1;");
  expect(b.getText()).toBe("// b\nconst b = 2;");
  model.dispose();
});
test("an edit URL starts with a reject checkpoint", () => {
  const model = new PlaygroundModel(
    "https://diffs.com/playground?view=file&edit=edit",
  );
  model.file.insertText("// temporary\n");
  model.finishEdit(false);
  expect(model.file.getText()).toBe(fixtures.file.contents);
  model.dispose();
});
