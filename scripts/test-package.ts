import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import manifest from "../package.json";

mkdirSync("dist/package", { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "pierre consumer "));
async function run(command: string[], cwd = process.cwd()) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, GPUIX_BACKGROUND: "1", GPUI_FONT_SMOOTHING: "0" },
    stdout: "inherit",
    stderr: "inherit",
  });
  assert.equal(await child.exited, 0, command.join(" "));
}
try {
  await run([
    process.execPath,
    "pm",
    "pack",
    "--quiet",
    "--filename",
    "dist/package/pierre-native.tgz",
  ]);
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "pierre-package-check",
        private: true,
        type: "module",
        dependencies: {
          "@erwinkn/pierre-native":
            "file:" + resolve("dist/package/pierre-native.tgz"),
          "@gpuix/react": manifest.devDependencies["@gpuix/react"],
          "@gpuix/native": manifest.devDependencies["@gpuix/native"],
          react: manifest.devDependencies.react,
        },
      },
      null,
      2,
    ),
  );
  copyFileSync("dist/runtime/pierre.node", join(directory, "pierre.node"));
  writeFileSync(
    join(directory, "check.ts"),
    `
import assert from 'node:assert/strict';
import { configureNativeBindings } from '@gpuix/native/runtime';
const info = configureNativeBindings(require('./pierre.node'));
assert.deepEqual(info.extensions.map(e => e.id), ['pierre-native']);
const { createTestRoot } = await import('@gpuix/react/testing');
const { createElement: h } = await import('react');
const { File, DiffProvider, Editor, prepareLanguages, renderDefaultPart } = await import('@erwinkn/pierre-native');
const file = { name: 'consumer.ts', contents: 'export const answer = 42;\\n' };
await prepareLanguages([file]);
const editor = new Editor('file', file);
const root = createTestRoot({width: 640, height: 320});
const parts = new Set();
try {
  root.render(h(DiffProvider, { renderPart(data) { parts.add(data.address); return renderDefaultPart(data); } },
    h(File, { id: 'consumer', file, editor, height: '100%' })));
  assert(root.renderer.findByTestId('consumer/viewport'));
  assert(parts.has('pierre/Viewport'), 'Host part adapter received the viewport');
  assert(root.renderer.getPaintedText().join('\\n').includes('answer'));
  editor.focus(); root.renderer.flush();
  root.renderer.simulateKeystrokes('cmd-a');
  root.renderer.simulateKeystrokes('x');
  assert.equal(editor.getText(), 'x');
} finally { root.unmount(); }
console.log('Installed library, fonts, host parts, native viewport and editing passed.');
`,
  );
  await run([process.execPath, "install"], directory);
  await run([process.execPath, "check.ts"], directory);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
