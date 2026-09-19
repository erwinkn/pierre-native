import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const url =
  process.env.PIERRE_WEB_URL ?? "http://localhost:4175/playground/?view=file";
const backend = process.env.PIERRE_WEB_BACKEND ?? "webgpu";
assert(["webgpu", "webgl"].includes(backend), "Unknown test backend");
const session = `pierre-native-check-${backend}-${process.pid}`;
const output = "docs/evidence/web/" + backend;
function browser(...args: string[]) {
  const p = Bun.spawnSync(["agent-browser", "--session", session, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode) throw Error(p.stderr.toString() || p.stdout.toString());
  return p.stdout.toString();
}
function evaluate(code: string) {
  const result = JSON.parse(browser("--json", "eval", code));
  if (!result.success) throw Error(JSON.stringify(result.error));
  return result.data.result;
}
mkdirSync(output, { recursive: true });
if (backend === "webgl") {
  browser("--init-script", "tests/fixtures/force-webgl.js", "open", url);
} else {
  browser("open", url);
}
browser("set", "viewport", "1440", "1000");
browser("reload");
browser(
  "wait",
  "--fn",
  '!!globalThis.pierrePlayground && !!document.querySelector("canvas")',
);
const checks = evaluate(`(async () => {
  const model = pierrePlayground, r = __gpuixRenderHost.renderer;
  const checks = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async (fn, message) => { const start = performance.now(); while (!fn()) { if (performance.now()-start>5000) throw Error(message); await new Promise(resolve=>setTimeout(resolve,16)); } };
  const paint = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  const find = id => { const walk=n=>n?.testId===id?n:n?.children?.map(walk).find(Boolean); return walk(JSON.parse(r.getAutomationTree())); };
  const box = id => { const n=find(id); assert(n, 'Missing '+id); const b=r.getElementBounds(n.id); assert(b, 'No bounds '+id); return b; };
  const click = async id => { const b=box(id); r.simulateClick(b.x+b.width/2,b.y+b.height/2); await paint(); };
  const key = async (id, keys) => { await gpuix.getByTestId(id).press(keys); await paint(); };
  const choose = async (menu,item) => { await click(menu); await click(menu+'/menu/item/'+item); };
  assert(crossOriginIsolated, 'Shared-memory isolation');
  assert(innerWidth === 1440 && innerHeight === 1000, 'Browser test viewport');
  assert(JSON.stringify(pierreRuntimeInfo.extensions.map(e => e.id)) === '["pierre-native"]', 'Standalone Pierre composition');
  assert(!performance.getEntriesByType('resource').some(e => /gpuix-web.*\\.wasm/.test(e.name)), 'Default runtime must not be fetched');
  const original = model.file.getText();
  await click('pg/start-edit'); await wait(()=>!model.file.options.readOnly,'Edit mode');
  await key('pg/file/viewport','x'); await wait(()=>model.file.getText()!==original,'Browser native typing');
  await key('pg/file/viewport','cmd-z'); await wait(()=>model.file.getText()===original,'Undo');
  await click('pg/reject-edit'); assert(model.file.options.readOnly,'Cancel review mode');
  checks.push('native browser keyboard input, undo, and Cancel');
  await click('pg/find');
  await gpuix.getByTestId('pg/file/search/query').fill('hashPassword'); await paint();
  await wait(()=>model.file.search.text==='hashPassword','Find query');
  await click('pg/file/search/toggle-replace');
  await gpuix.getByTestId('pg/file/search/replacement').fill('hash'); await paint();
  await click('pg/file/search/replace');
  await wait(()=>model.file.getText()===original.replace('hashPassword','hash'),'Replace');
  await click('pg/file/search/toggle-replace'); assert(!find('pg/file/search/replacement'),'Collapse replace');
  await click('pg/file/search/close'); await click('pg/reject-edit');
  assert(model.file.getText()===original,'Cancel replacement');
  checks.push('find, expand/collapse replace, replacement, and cancellation');
  const vp=box('pg/file/viewport');
  r.simulateMouseMove(vp.x+150,vp.y+14*20+10); await paint();
  await click('pg/add-comment'); const comment=model.comments.file.at(-1);
  const input='pg/comment/'+comment.id+'/input';
  await gpuix.getByTestId(input).fill('browser draft'); await paint(); const inputId=find(input).id;
  for(const line of [10,7,2]) {r.simulateMouseMove(vp.x+150,vp.y+line*20+10);await paint();assert(find(input).id===inputId,'Draft identity after hover');}
  await click('pg/comment/'+comment.id+'/submit');
  assert(model.comments.file.at(-1).body==='browser draft','Draft text survives hover');
  model.deleteComment(comment.id); await paint(); checks.push('native comment input retains its text during hover');
  for(const view of ['virtualizer','virtualizer-element','codeview']) {
    await choose('pg/view',view);
    const id=view==='codeview'?'file:README.md':'diff-0';
    await wait(()=>find(id+'/header'),'Collection header');
    const e=model.collection.get(id), before=e.getText();
    await click('pg/start-edit/'+id); await key('pg/collection/viewport','x');
    await wait(()=>e.getText()!==before,'Collection typing '+view);
    const h=box(id+'/header'),v=box('pg/collection/viewport'),save=box('pg/accept-edit/'+id);
    assert(h.width===v.width,'Full-width header '+view);
    assert(h.x+h.width-save.x-save.width-1===8,'Right-aligned Save '+view);
    await click('pg/reject-edit/'+id); assert(e.getText()===before,'Collection Cancel '+view);
    checks.push(view+': typing, full-width header, right-aligned controls, and Cancel');
  }
  await choose('pg/view','diff'); await paint();
  checks.push('diff view and embedded images');
  return checks;
})()`);
assert(Array.isArray(checks));
browser("screenshot", output + "/playground.png");
const errors = browser("errors").trim();
assert(!errors, errors);
const consoleText = browser("console");
assert(!consoleText.includes("[error]"), consoleText);
assert(
  consoleText.includes(
    "Browser graphics initialized successfully with " +
      (backend === "webgl" ? "Gl" : "BrowserWebGpu"),
  ),
  "Expected graphics backend was not used: " + consoleText,
);
writeFileSync(
  output + "/verification.json",
  JSON.stringify({ passed: true, url, backend, checks }, null, 2) + "\n",
);
console.log(checks);
browser("close");
