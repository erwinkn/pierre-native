export type Step =
  | { type: "text"; text: string }
  | {
      type: "key";
      key: string;
      meta?: boolean;
      ctrl?: boolean;
      alt?: boolean;
      shift?: boolean;
    }
  | { type: "select"; ranges: [number, number][] }
  | {
      type: "edit";
      start: number;
      end: number;
      text: string;
      history?: boolean;
    };
export type Case = {
  name: string;
  file: string;
  text: string;
  steps: Step[];
  surface?: "diff";
  oldText?: string;
};
const k = (
  key: string,
  mod: Partial<Extract<Step, { type: "key" }>> = {},
): Step => ({ type: "key", key, ...mod });
export const behaviorCases: Case[] = [
  {
    name: "typing-history",
    file: "a.ts",
    text: "",
    steps: [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
      { type: "text", text: "c" },
      k("z", { meta: true }),
      k("z", { meta: true, shift: true }),
    ],
  },
  {
    name: "multi-cursor",
    file: "a.ts",
    text: "cat cat cat",
    steps: [
      {
        type: "select",
        ranges: [
          [8, 11],
          [0, 3],
          [4, 7],
        ],
      },
      { type: "text", text: "dogs" },
      k("z", { meta: true }),
      k("z", { meta: true, shift: true }),
    ],
  },
  {
    name: "find-occurrence",
    file: "a.ts",
    text: "cat cat cat",
    steps: [
      k("d", { meta: true }),
      k("d", { meta: true }),
      k("d", { meta: true }),
      { type: "text", text: "dog" },
    ],
  },
  {
    name: "surround",
    file: "a.ts",
    text: "alpha beta",
    steps: [
      {
        type: "select",
        ranges: [
          [0, 5],
          [6, 10],
        ],
      },
      { type: "text", text: "(" },
    ],
  },
  {
    name: "indent-cursors",
    file: "a.ts",
    text: "abc",
    steps: [
      {
        type: "select",
        ranges: [
          [0, 0],
          [2, 2],
        ],
      },
      k("Tab"),
      k("Tab", { shift: true }),
    ],
  },
  {
    name: "indent-block",
    file: "a.ts",
    text: "one\ntwo\nthree",
    steps: [
      { type: "select", ranges: [[0, 13]] },
      k("Tab"),
      k("Tab", { shift: true }),
    ],
  },
  {
    name: "move-lines",
    file: "a.ts",
    text: "one\ntwo\nthree",
    steps: [
      { type: "select", ranges: [[5, 5]] },
      k("ArrowUp", { alt: true }),
      k("ArrowDown", { alt: true }),
      k("ArrowDown", { alt: true, shift: true }),
    ],
  },
  {
    name: "blank-line",
    file: "a.ts",
    text: "  one\ntwo",
    steps: [{ type: "select", ranges: [[4, 4]] }, k("Enter", { meta: true })],
  },
  {
    name: "comment-typescript",
    file: "a.ts",
    text: "const x = 1;\nconst y = 2;",
    steps: [
      k("a", { meta: true }),
      k("/", { meta: true }),
      k("/", { meta: true }),
    ],
  },
  {
    name: "comment-python",
    file: "a.py",
    text: "print(1)\nprint(2)",
    steps: [
      k("a", { meta: true }),
      k("/", { meta: true }),
      k("/", { meta: true }),
    ],
  },
  {
    name: "block-comment",
    file: "a.ts",
    text: "alpha beta",
    steps: [
      { type: "select", ranges: [[0, 5]] },
      k("a", { alt: true, shift: true }),
      k("z", { meta: true }),
    ],
  },
  {
    name: "unicode",
    file: "a.txt",
    text: "a👩‍💻e\u0301中",
    steps: [
      { type: "select", ranges: [[1, 1]] },
      k("ArrowRight"),
      k("Backspace"),
      k("ArrowRight"),
      k("Backspace"),
    ],
  },
  {
    name: "document-boundaries",
    file: "a.ts",
    text: "one\ntwo\nthree",
    steps: [
      k("ArrowDown", { meta: true }),
      k("ArrowUp", { meta: true, shift: true }),
      k("Escape"),
    ],
  },
  {
    name: "reversed-selection",
    file: "a.ts",
    text: "abcdef",
    steps: [
      { type: "select", ranges: [[5, 1]] },
      { type: "text", text: "X" },
    ],
  },
  {
    name: "external-edit",
    file: "a.ts",
    text: "abcdef",
    steps: [
      { type: "select", ranges: [[2, 5]] },
      { type: "edit", start: 0, end: 1, text: "long" },
      k("z", { meta: true }),
      k("z", { meta: true, shift: true }),
    ],
  },
  {
    name: "history-without-metadata",
    file: "a.ts",
    text: "abcdef",
    steps: [
      { type: "select", ranges: [[2, 2]] },
      { type: "edit", start: 0, end: 0, text: "X", history: false },
      k("z", { meta: true }),
      k("z", { meta: true, shift: true }),
    ],
  },
  {
    name: "crlf",
    file: "a.ts",
    text: "a\r\nb\r\n",
    steps: [
      { type: "select", ranges: [[1, 1]] },
      { type: "text", text: "\nx\ny" },
      k("z", { meta: true }),
    ],
  },
  {
    name: "delete-to-start",
    file: "a.ts",
    text: "alpha beta",
    steps: [
      { type: "select", ranges: [[7, 7]] },
      k("Backspace", { meta: true }),
      k("z", { meta: true }),
    ],
  },
  {
    name: "goal-column",
    file: "a.ts",
    text: "abcdefgh\nx\nabcdefgh",
    steps: [
      { type: "select", ranges: [[7, 7]] },
      k("ArrowDown"),
      k("ArrowDown"),
      k("ArrowUp", { shift: true }),
    ],
  },
];

// Repeatable mixed operations expose interactions between history, selections and edits.
let seed = 0x173bd2;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
for (let run = 0; run < 24; run++) {
  const steps: Step[] = [];
  for (let i = 0; i < 32; i++) {
    const pick = Math.floor(random() * 10);
    if (pick < 3)
      steps.push({
        type: "text",
        text: ["a", "🙂", "e\u0301", "中", "foo", "("][
          Math.floor(random() * 6)
        ],
      });
    else if (pick === 3) steps.push(k("Backspace"));
    else if (pick === 4)
      steps.push(
        k(random() < 0.5 ? "ArrowLeft" : "ArrowRight", {
          shift: random() < 0.4,
        }),
      );
    else if (pick === 5)
      steps.push(
        k(random() < 0.5 ? "ArrowUp" : "ArrowDown", { shift: random() < 0.4 }),
      );
    else if (pick === 6)
      steps.push(k("z", { meta: true, shift: random() < 0.4 }));
    else if (pick === 7) steps.push(k("Tab", { shift: random() < 0.5 }));
    else if (pick === 8)
      steps.push(
        k(random() < 0.5 ? "ArrowLeft" : "ArrowRight", {
          meta: true,
          shift: random() < 0.4,
        }),
      );
    else
      steps.push({
        type: "select",
        ranges: [[Math.floor(random() * 14), Math.floor(random() * 14)]],
      });
  }
  behaviorCases.push({
    name: `seeded-${run}`,
    file: "random.ts",
    text: "alpha\nbeta 🙂\ngamma\n",
    steps,
  });
}

behaviorCases.push(
  {
    name: "diff-final-newline",
    surface: "diff",
    file: "change.txt",
    oldText: "old\n",
    text: "new\n",
    steps: [
      k("ArrowDown", { meta: true }),
      { type: "text", text: "x" },
      k("z", { meta: true }),
    ],
  },
  {
    name: "diff-select-all",
    surface: "diff",
    file: "change.txt",
    oldText: "old\n",
    text: "new\n",
    steps: [
      k("a", { meta: true }),
      { type: "text", text: "replacement" },
      k("z", { meta: true }),
      k("z", { meta: true, shift: true }),
    ],
  },
  {
    name: "diff-line-commands",
    surface: "diff",
    file: "change.ts",
    oldText: "const x = 1;\nconst y = 2;\n",
    text: "const x = 3;\nconst y = 4;\n",
    steps: [
      k("a", { meta: true }),
      k("/", { meta: true }),
      k("Tab"),
      k("z", { meta: true }),
      k("z", { meta: true }),
    ],
  },
);
