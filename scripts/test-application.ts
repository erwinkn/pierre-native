import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { launch } from "@gpuix/react/automation";

const moved = mkdtempSync(join(tmpdir(), "pierre relocated "));
const env = { ...process.env, GPUIX_BACKGROUND: "1", GPUI_FONT_SMOOTHING: "0" };
async function check(command: string, args: string[], cwd: string) {
  const app = await launch({ command, args, cwd, env });
  try {
    await app.getByTestId("pg/file/viewport").waitFor({ timeoutMs: 20000 });
    await app.getByTestId("pg/start-edit").click();
    await app.getByTestId("pg/accept-edit").waitFor();
    const view = app.getByTestId("pg/file/viewport");
    await view.press("cmd-a");
    await view.press("x");
    const start = performance.now();
    for (;;) {
      const painted = await app.call("getPaintedText", {});
      if (painted.text.includes("x")) break;
      assert(
        performance.now() - start < 5000,
        "Native host typing did not paint",
      );
      await Bun.sleep(20);
    }
    await view.press("cmd-z");
    await app.getByTestId("pg/reject-edit").click();
    await app.getByTestId("pg/start-edit").waitFor();
  } finally {
    await app.close();
  }
}
try {
  await check(
    process.execPath,
    [resolve("examples/bootstrap.ts")],
    process.cwd(),
  );
  const build = Bun.spawn([process.execPath, "scripts/build-desktop.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  assert.equal(await build.exited, 0, "Desktop build");
  const executable = join(moved, "pierre-native");
  copyFileSync(
    "dist/Pierre Native.app/Contents/MacOS/pierre-native",
    executable,
  );
  await check(executable, [], moved);
  console.log("Source and relocated compiled playground worker passed.");
} finally {
  rmSync(moved, { recursive: true, force: true });
}
