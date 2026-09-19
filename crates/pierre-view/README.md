# Shared GPUI viewport

`Viewport` is an ordinary GPUI `Render` view. The default crate depends on GPUI,
serde, CSS color parsing, and Unicode helpers. It does not load a React renderer.
It owns one live `Spec`, native selection and scroll state, IME preview, geometry,
and shaped-line caches. Both adapters use this implementation.

```rust
let editor = cx.new(|cx| Viewport::new(spec, window, cx));
// The view fills its GPUI layout parent.
div().size_full().child(editor)
```

The existing document model remains outside this viewport. Native key and insert
events request committed edits from that model. IME preedit, selection, scrolling,
geometry, and paint remain native. This extraction does not move the JavaScript
editor model or undo history into Rust, and does not promise committed typing
while that model's worker is blocked.

`Spec`, `Row`, `Cell`, `Token`, `Selection`, and `Prediction` are public Rust
payload types in `src/model.rs`. Their camelCase JSON fields and defaults retain
the existing viewport contract. `ViewState` contains the selection, decoration,
prediction, session, acknowledgement, focus, reveal, and scroll fields from the
existing `view` payload. `Update` accepts optional `spec`, `view`, and `patch`.
A patch keeps its existing base/version, row splice, text-edit, shift, and chain
format. Duplicate and mismatched-base patches keep the existing no-op behavior.

Native callers use:

- `new(spec, window, cx)` to create the view and its focus observers.
- `apply_spec(spec, window, cx)` to move a complete source into the view.
- `apply_update(update, window, cx)` to apply a source, view state, and patch in order.
- `set_children(children, cx)` to supply ordinary GPUI views for annotation slots.
- `Focusable::focus_handle` for normal GPUI focus control.
- `set_paint_observer(Some(Rc<dyn Fn(SharedString)>))` for optional painted text inspection, including chrome. The observer must not re-enter the viewport.
- `snapshot()` for current active text, old text, document version, native event sequence, selection, side, composition range, scroll offsets, last bounds, paint count, and painted document version.
- `shutdown(window)` to stop native tasks and remove focus before unmount.

Snapshot offsets use UTF-16. `text` follows the active side and includes the IME
preview when one exists. Bounds are `[x, y, width, height]` in logical window
pixels. They describe the last native layout, not a forced fresh measurement.
`paintedDocumentVersion` and `paintCount` identify completed native paint work.
Source updates first restore native IME row backups. A full source with the same
session and text rebuilds the preview against the new rows. An accepted patch
that leaves text unchanged does the same. A changed text source or session
cancels the old preview. This prevents stale backup indices and stale preedit
text from entering a replacement. It does not cancel an OS candidate window.

`ViewportEvent(Value)` implements GPUI's event interface. Its JSON contents keep
`kind`, increasing `seq`, `documentVersion`, and the existing kind-specific
fields for layout, hover, scroll, selection, insert, key, action, focus, and blur.
Callbacks run through GPUI's event system. Native focus/blur observations follow
GPUI window activation rules. Scrolling consumes the default wheel action only
when the viewport moves. Parent wheel observers remain reachable, and a later
wheel at a boundary can scroll a parent.

## Optional adapters

Feature `legacy` provides `register()` for the existing `gpuix-native` extension
API. `pierre-native-runtime` enables it and remains the default workspace build.
It preserves the `spec`, `view`, and `patch` props, focus/style/accessibility
integration, annotation children, text inspection, and the existing `change`
event envelope whose `value` contains JSON text. Its pending full source moves
into the viewport instead of remaining as a second typed specification.

Feature `react` implements the new bridge traits directly on `Viewport`.
The implementations live beside the type because Rust's orphan rule forbids a
separate crate from implementing a foreign trait on a foreign view. This avoids
an extra wrapper entity or event relay. `react::register` adds `pierre-viewport`
to a new bridge registry. `crates/pierre-react` is the opt-in native composition.
The default view and browser runtime do not enable this feature.

Build the compositions separately so workspace feature unification does not
include the legacy renderer in a new-host binary. The root default-members
setting preserves the legacy default. No npm pins or default JS entries change.

Tests cover source ownership, real GPUI layout/paint, native event payloads,
stale selection acknowledgements, ordered patches, native annotation resizing,
and source replacement, patches, and presentation changes during IME. With `react`, tests also cover update decoding,
frame tags, and an event queued immediately before removal.

```sh
cargo test --release -p pierre-native-view
cargo test --release -p pierre-native-view --features react
```

The macOS GPU check keeps its window off screen. It tests the platform input
handler, IME event payloads, native focus, nested scroll observers and boundary
chaining, and split-diff glyph/background pixels.

```sh
cargo run --release --locked -p pierre-native-view --example visual
```
