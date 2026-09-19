# Use the library

The package exports GPUIX React components and editor controllers. The host
must load a runtime with the `pierre-viewport` extension before it imports React
or the library. See [architecture.md](architecture.md) for the runtime contract.

```tsx
import { useState } from "react";
import { DiffProvider, File, type FileContents } from "@erwinkn/pierre-native";

export function EditorPane() {
  const [file, setFile] = useState<FileContents>({
    name: "hello.ts",
    contents: 'export const greeting = "Hello";\n',
  });
  return (
    <DiffProvider>
      <File file={file} edit height="100%" onEditChange={setFile} />
    </DiffProvider>
  );
}
```

Give the editor a parent with a finite height. Without `edit` or an editable
controller, `File` opens in review mode. Review mode permits selection and copy
but does not show an insertion caret.

## Components

| Export           | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `File`           | Display or edit one file.                       |
| `FileDiff`       | Display two versions in split or unified mode.  |
| `PatchDiff`      | Parse and display a patch.                      |
| `MultiFileDiff`  | Display multiple file diffs in one scroll view. |
| `CodeView`       | Display a collection of files and diffs.        |
| `TabbedFileDiff` | Switch between file diffs with tabs.            |
| `UnresolvedFile` | Display and resolve merge conflicts.            |
| `FileStream`     | Display a file supplied as streamed content.    |

All collection views use native row virtualization. The playground's two
virtualizer choices use the same native collection renderer with the matching
Pierre sample data and controls.

`options` controls the theme, split or unified layout, wrapping, line numbers,
change indicators, context expansion, and diff comparison style. The exported
`CommonCodeProps`, `FileProps`, `FileDiffProps`, and `DiffOptions` types describe
the supported options.

Use the render callbacks for headers, annotations, markers, gutter actions,
and selected-text actions. `enableLineSelection` is independent of comment
buttons. A host can enable both interaction patterns.

## Controllers

Create an `Editor` when the host needs direct access to document state, search,
selections, markers, or edit history. Keep the controller stable across React
renders, then pass it through the component's `editor` prop.

```ts
import { Editor } from "@erwinkn/pierre-native/editor";

const editor = new Editor("file", {
  name: "hello.ts",
  contents: 'export const greeting = "Hello";\n',
});

const unsubscribe = editor.subscribe(() => {
  console.log(editor.getText());
});
```

Call `unsubscribe()` when the host no longer needs updates. The controller's
public types describe editing commands and state. Positions use zero-based line
numbers and UTF-16 character offsets, as Pierre does.

## Themes and host parts

The editor exports `pierreDark`, `pierreLight`, and `resolveTheme`. Shiki syntax
themes can be registered with `registerTheme`. The provider's `theme` controls
the surrounding UI. Its `renderPart` callback lets a host apply its component
registry to each named part.

```tsx
<DiffProvider renderPart={(data) => hostParts.render(data)}>
  <File file={file} />
</DiffProvider>
```

The part renderer must retain the native element and children when it decorates
a part. Use the exported `renderDefaultPart(data)` for the normal fallback.

## Clipboard and selected code

Browsers use `navigator.clipboard`. Native hosts must call
`configureClipboard({ readText, writeText })`. The standalone desktop entry
provides a macOS clipboard adapter.

`renderSelectionAction` receives the editor and selected text. Use it to send
code to the host's chat provider. The public demo keeps selected snippets in
memory and can copy them. It has no credentials or model provider. Cherry owns
its Pi provider integration.

The tab prediction demo is omitted. The lower-level prediction request types
remain available for hosts that need them.
