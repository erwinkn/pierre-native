# Third-party notices

## Ported source

GPUIX's text selection, syntax highlighting, markdown renderer and diff viewer
are ported from **[Comet](https://github.com/zeronsh/comet)** (MIT, Copyright (c)
2026 Wing). The ported files carry a header naming their original.

The selection port includes Comet's
[`f6911c3`](https://github.com/zeronsh/comet/commit/f6911c311dc654734d31bc3097a84fb73659939f)
soft-wrap geometry fix and
[`3536a37`](https://github.com/zeronsh/comet/commit/3536a3702ca405fec1321e95f54e280240c5d38f)
virtualized drag fix. Input is not a wholesale Comet port. Its caret blink,
double-click, drag autoscroll, and bounded undo follow generic composer
behavior reviewed at
[`b3fa518`](https://github.com/zeronsh/comet/commit/b3fa51872f70c8f973c241b659cf0c166766f4f5).

| GPUIX file | Comet original |
| --- | --- |
| `packages/native/src/text/selection.rs` | [`crates/ui/src/markdown/selection.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/markdown/selection.rs) |
| `packages/native/src/text/paint.rs` | [selection sections of `crates/ui/src/markdown/render.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/markdown/render.rs) |
| `packages/native/src/text/runs.rs` | `runs_for_syntax_line_with_plain` in `crates/ui/src/markdown/render.rs` |
| `packages/native/src/syntax/mod.rs` | `crates/syntax/src/lib.rs` |
| `packages/native/src/syntax/cache.rs` | `crates/ui/src/syntax_cache.rs` |
| `packages/native/src/markdown/parser.rs` | `crates/ui/src/markdown/parser.rs` |
| `packages/native/src/markdown/render.rs` | `crates/ui/src/markdown/render.rs` |
| `packages/native/src/diff/mod.rs` | pure sections of `crates/ui/src/changes.rs` |
| `packages/native/src/custom_elements/diff.rs` | rendering sections of `crates/ui/src/changes.rs` |
| `packages/native/src/custom_elements/code.rs` | `render_code_block` in `crates/ui/src/markdown/render.rs` |
| `packages/native/src/custom_elements/input.rs` | [caret blink sections of `crates/ui/src/composer.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/composer.rs) |
| `packages/native/src/theme.rs` | `crates/ui/src/theme.rs` |
| `packages/native/src/updater.rs` | [cargo-packager-updater 0.2.3](https://github.com/crabnebula-dev/cargo-packager/blob/v0.2.3/crates/updater/src/lib.rs) (MIT OR Apache-2.0). HTTP uses GPUIX `reqwest_client`, not crates.io `reqwest`. |

The new `crates/gpui-react-controls` input retains these GPUI and Comet references.
Its source notice and MIT permission text are in
[`crates/gpui-react-controls/THIRD_PARTY_NOTICES.md`](./crates/gpui-react-controls/THIRD_PARTY_NOTICES.md).

## Example icons

The chat example uses **[Lucide](https://github.com/lucide-icons/lucide)** SVG
icons (ISC, Copyright (c) 2026 Lucide Icons and Contributors). The OpenAI mark
is ported from **[Comet](https://github.com/zeronsh/comet)** (MIT, Copyright (c)
2026 Wing).

## Bundled syntax definitions

Syntax highlighting uses **[Syntect](https://github.com/trishume/syntect)** (MIT)
with its pure-Rust **[fancy-regex](https://github.com/fancy-regex/fancy-regex)**
engine (MIT). Extra Sublime syntaxes (TypeScript, TSX, TOML, and others missing
from Syntect's default dump) come from **[two-face](https://codeberg.org/CosmicHarper/two-face)**,
the pack curated by [bat](https://github.com/sharkdp/bat). Versions are pinned
in `packages/native/Cargo.lock`.

The two-face crate is MIT OR Apache-2.0. The **embedded syntax files** have
their own licenses (Sublime, MIT, BSD, Apache, and others). The full listing
is in two-face's
[acknowledgements](https://codeberg.org/CosmicHarper/two-face/src/branch/main/generated/acknowledgements_full.md).

| Component | License | Source |
| --- | --- | --- |
| Syntect | MIT | https://github.com/trishume/syntect |
| fancy-regex | MIT | https://github.com/fancy-regex/fancy-regex |
| two-face crate | MIT OR Apache-2.0 | https://codeberg.org/CosmicHarper/two-face |

## Other dependencies

| Component | License | Source |
| --- | --- | --- |
| pulldown-cmark | MIT | https://github.com/pulldown-cmark/pulldown-cmark |
| arboard | MIT / Apache-2.0 | https://github.com/1Password/arboard |
| GPUI | Apache-2.0 | https://github.com/zed-industries/zed |

GPUIX itself is licensed under the terms in `LICENSE`.
