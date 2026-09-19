import { test, expect } from "bun:test";
import { Editor } from "../src/diffs/editor";
import { behaviorCases } from "./diffs/behavior-cases";
import reference from "./diffs/reference-behavior.json";
for (const c of behaviorCases)
  test(`Pierre browser transcript: ${c.name}`, () => {
    const e = new Editor(c.surface === "diff" ? "file-diff" : "file", {
      name: c.file,
      contents: c.text,
    });
    const states: unknown[] = [];
    for (const step of c.steps) {
      if (step.type === "text") e.insertText(step.text);
      else if (step.type === "select")
        e.setSelections(
          step.ranges.map(([a, b]) => ({
            start: e.document.positionAt(a),
            end: e.document.positionAt(b),
            direction: a === b ? "none" : "forward",
          })),
        );
      else if (step.type === "edit")
        e.applyEdits(
          [
            {
              range: {
                start: e.document.positionAt(step.start),
                end: e.document.positionAt(step.end),
              },
              newText: step.text,
            },
          ],
          step.history ?? true,
        );
      else
        e.handleNativeEvent({
          kind: "key",
          ...step,
          key:
            (
              {
                ArrowUp: "up",
                ArrowDown: "down",
                ArrowLeft: "left",
                ArrowRight: "right",
                Tab: "tab",
                Enter: "enter",
                Escape: "escape",
                Backspace: "backspace",
              } as Record<string, string>
            )[step.key] ?? step.key,
        });
      states.push({
        text: e.getText(),
        selections: structuredClone(e.selections),
      });
    }
    expect(states).toEqual(
      reference.cases.find((r) => r.name === c.name)!.states,
    );
  });
