import { mkdirSync } from "node:fs";

mkdirSync("docs/evidence/diffs", { recursive: true });
mkdirSync("docs/evidence/playground", { recursive: true });
const suites = [
  "diffs-native-test.tsx",
  "diffs-interaction-test.tsx",
  "diffs-extended-test.tsx",
  "diffs-edge-test.tsx",
  "playground-native-test.tsx",
  "playground-regression-test.tsx",
  "playground-collection-test.tsx",
];
for (const suite of suites) {
  console.log(`Running ${suite}`);
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./examples/register-runtime.ts",
      `scripts/${suite}`,
    ],
    {
      env: { ...process.env, GPUIX_BACKGROUND: "1", GPUI_FONT_SMOOTHING: "0" },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const status = await child.exited;
  if (status) process.exit(status);
}
