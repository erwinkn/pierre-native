# Verification

## Release check, 19 September 2026

Local verification passed with GPUiX
`5f5de7b61a57a44b4e13466068d5cc056de3a9a2` and GPUI
`feda54e61a9469cf484c387c341382d3172cecb6`:

- 636 unit and source parity tests, with 64,248 assertions and eight snapshots.
- All seven native editor and playground suites, including IME and counted clicks.
- Source and relocated compiled application worker tests.
- Archive installation into an independent consumer, including fonts, host parts,
  native rendering, and editing.
- The full browser interaction suite on WebGPU and WebGL2. The deployed preview
  also passed both suites with the matching `5f5de7b` browser artifact. Its
  WebAssembly SHA-256 is
  `751837e5ca06f98682cc1bef60200507dc8aa1c00599df3008d2042e21468e3a`.

The default renderer and JavaScript release pins stay unchanged. The framework
owner also verified the ordinary GPUI view and optional new bridge separately.
Those checks do not replace the default playground suites above.

GitHub Actions repeats the build and checks from the committed source. Cloudflare
automatic deployment still requires its Git connection or a repository API token.

## Source checks

Run the unit and source parity checks with:

```sh
bun run typecheck
bun test tests vendor/pierre/test
```

The suite includes the vendored Pierre algorithm tests, native controller
tests, and recorded command transcripts from the original browser editor.
It compares document text and selections after each command. The layout tests
also compare native soft-line offsets with recorded browser measurements.

## Native checks

Native tests create actual GPUI renderers. They check native keyboard input,
IME ranges, hit testing, selection painting, search and replacement, comment
input identity, and collection edit controls. Screenshot checks cover dark
and light themes, split and unified diffs, wrapping, and narrow windows.

These tests need a desktop graphics session. Set `GPUIX_BACKGROUND=1` to keep
test windows in the background. Set `GPUI_FONT_SMOOTHING=0` before process
startup to use the demo's macOS text rendering setting.

## Browser checks

Start the built website, install `agent-browser`, and run:

```sh
bun run web
# In another terminal:
bun scripts/browser-test.ts
PIERRE_WEB_BACKEND=webgl bun scripts/browser-test.ts
```

The test uses the real compiled renderer. It checks typing, undo, Cancel,
find, replacement, comment drafts during hover, collection editing, header
bounds, and image loading. It fails on browser errors and confirms the selected
graphics backend from GPUI's startup log.

The WebGL test makes `navigator.gpu.requestAdapter()` return `null` before
startup. It then uses the actual browser WebGL2 implementation. It does not
mock drawing, text layout, or editor input.

Set `PIERRE_WEB_URL` to test a deployed playground. The URL must point to
`/playground/?view=file`. Evidence is written to `docs/evidence/web`.

## Limits of the checks

The test results do not prove exact pixel parity on every GPU or platform.
Font rasterization differs between native Metal, browser WebGPU, and WebGL2.
WebGL2 can use grayscale text antialiasing when dual-source blending is absent.
Manual inspection remains useful for IME candidate windows and platform
clipboard permissions.
