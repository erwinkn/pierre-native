# Pierre source

This directory contains the browser-independent algorithms from `@pierre/diffs` at the revision in `manifest.json`. The Apache 2.0 license is in `LICENSE.md`.

The native implementation uses the same patch parser, diff alignment, document piece table, selection transforms, edit history, comment commands, and prediction request logic. The native renderer uses GPUI for text layout, input, selection geometry, and painting.

The manifest records each original source hash and local hash. It marks adapted files. `EditStateManager` uses a native owner object. `matchBrackets` accepts the native tokenizer contract. Test imports and fixture paths point to this vendored tree. The source suite includes 534 tests; mixed browser-only rendering cases need the separate browser and native checks in the app.

`src/types.ts` forwards the published package types. The editor type import in `src/editor/types.ts` refers to the published declaration. `src/editor/searchPanel.ts` contains only the search parameter type. The browser rendering helpers in the imported files are not called by native code.

`src/diffs/editor.ts` in the app adapts the command dispatch and command edit methods from Pierre's `editor/editor.ts`. It replaces DOM focus, selection, and scroll operations with native callbacks.
