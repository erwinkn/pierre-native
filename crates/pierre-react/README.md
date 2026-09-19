# Opt-in asynchronous Pierre composition

This native composition links the shared `Viewport`, standard controls, and
`gpui-react-host`. It has no dependency on the old `gpuix-native` renderer when
built alone. It is separate from the default legacy native/WASM composition.
The new application bootstrap currently supports macOS with Bun.

```sh
cargo build --release --locked -p pierre-react-runtime
# Copy target/release/libpierre_react_runtime.dylib to pierre-react.node.
# Use CARGO_TARGET_DIR when it is set.
```

Both Rust adapters pin the same full framework revision in the root manifest.
Do not mix GPUI types from another build or load two native compositions into
one application. The new host is a Rust library; this crate emits the `.node`.

The React wrapper is:

```tsx
const Pierre = nativeComponent<Props, Event, Command, null, Reply>("pierre-viewport")
```

Props are `initialSpec`, `style`, and `label`, with empty defaults. `initialSpec`
uses the existing object payload and is construction-only. `style` uses the
standard controls' style contract. The viewport does not retain a second props document. However, the bridge sends
complete props on a prop update. For a large document, omit `initialSpec` and send
`update` from a mount layout effect so later style updates do not resend source. Children are native annotation views referenced by row slots.

```tsx
const editor = useRef<NativeRef<Command, null, Reply>>(null)
useLayoutEffect(() => {
  void editor.current!.command({ type: "update", spec: initialDocument })
  void editor.current!.command({ type: "focus" })
}, [])
return <Pierre ref={editor} style={style} onEvent={handleNativeEvent} />
```

Both synchronous layout-effect calls join the mount transaction, so the first
native draw can use that source. A later source update uses another command.
Attach error handling as required by the application.

Commands are `focus`, `blur`, and `update`. An update uses
`{type: 'update', spec?, view?, patch?}` with the existing object payloads.
It applies source/view/patch changes in that order. A synchronous layout-effect
command joins the corresponding React transaction. Focus does not activate an
OS window. Old `focusRequest` metadata still controls input/reveal behavior;
use the native focus command when the new host must move focus.

`onEvent` receives the existing event contents as an object, including `kind`,
`seq`, and `documentVersion`. The legacy adapter still returns JSON text in its
`change.value` envelope. New code does not need that extra stringify/parse step.
The existing document model must consume key/insert events and publish its
updates; this composition does not replace that model.

`query(null)` returns the native viewport snapshot, `focused` for logical GPUI
focus, and the last painted bridge `frame` tag. Focus/blur events follow GPUI window activation rules. A hidden, inactive window
can have logical focus without emitting an active-window focus event.
State can be newer than paint. Queries do not run layout. The native
view README defines the snapshot fields and update behavior.

Startup uses the same composition object in host and worker:

```ts
// host.ts
import { runApplication } from "@gpuix/bridge/application"
const bindings = require("./pierre-react.node")
await runApplication(bindings, new URL("./worker.tsx", import.meta.url), {
  title: "Pierre", width: 900, height: 600,
})
```

```tsx
// worker.tsx
import { attachApplication } from "@gpuix/bridge/application"
const bindings = require("./pierre-react.node")
const root = attachApplication(bindings)
// Register the typed wrapper above, then root.render(<Pierre ... />).
```

Compile both entry points with Bun when building an executable. Existing
`@gpuix/react` controls are not drop-in wrappers for this API. Use
`@gpuix/bridge-controls` or an ordinary GPUI component binding. Keep the current
legacy browser path until a separate browser bootstrap is implemented and tested.

## Background frame test

The optional `frame-probe` feature registers `pierre-frame-probe`, a test-only
container that draws from the native executor every 16 ms until unmount. macOS
stops display callbacks for hidden or fully covered windows. This test driver
lets the GPUiX external probe check later paint without activating a window.
It is absent from the default composition and is not a production frame loop.

```sh
cargo build --release --locked -p pierre-react-runtime --features frame-probe
# Then, in the GPUiX checkout:
bun fixtures/bridge-pierre/test.ts /path/to/libpierre_react_runtime.dylib --frames
```

Run the same external probe against a normal build without `--frames` to test
the unmodified host. Both modes test source workers and relocated executables.
The frame mode also verifies later document paint and annotation resize.
