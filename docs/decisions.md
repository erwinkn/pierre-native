# Implementation decisions

These decisions cover the extraction from Cherry and the standalone demo.
The user authorized the separate repositories, commits, package, and deployment.

| Decision                                                                                 | Alternative                                                     | Confidence | Consequence                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ship Bun-compatible TypeScript source and assets.                                        | Ship a separate JavaScript bundle and declarations.             | Medium     | Consumers need a build that understands the asset imports and top-level await. Bun is the documented build tool.                             |
| Retain the surrounding UI theme contract from Cherry.                                    | Define a smaller incompatible theme type.                       | Medium     | The theme has some fields the editor does not use. Cherry can supply its existing theme without conversion.                                  |
| Use the legacy GPUiX adapter for the default app.                                        | Move the whole playground to the new asynchronous bridge now.   | High       | The browser demo remains supported. The new bridge stays opt-in until it has a browser driver and the full component set.                    |
| Keep committed document edits and history in the existing TypeScript model.              | Port the document engine to Rust during this extraction.        | High       | The native viewport keeps rendering, selection, scrolling, and IME preview. Committed typing still needs the application worker.             |
| Keep one GPUI viewport with optional adapters.                                           | Maintain separate implementations for each renderer.            | High       | Both adapters must use the same compiled GPUI revision. Cargo builds select one composition at a time.                                       |
| Pin the JavaScript packages to the shared fork release and Rust to a tested full commit. | Use mutable branch dependencies or local paths.                 | High       | Updates require an explicit compatibility check. A fresh clone can resolve the dependencies without a Cherry checkout.                       |
| Make the React API a peer and let the application select its runtime.                    | Have the library load its own native binary.                    | High       | The host must configure one composition before React imports. This avoids multiple GPUI runtimes in one process.                             |
| Replace Cherry's internal part resolution with a public callback.                        | Copy the Cherry plugin registry into the library.               | High       | Cherry must pass its registry adapter through DiffProvider. Standalone apps use the default renderer. The package test covers this callback. |
| Keep the original Pierre source manifests and use its published declaration types.       | Fork all declarations or replace the algorithms.                | High       | The package retains a dependency on @pierre/diffs for types. Its browser renderer is not used.                                               |
| Bundle fonts and sample images locally.                                                  | Fetch them from third-party URLs at runtime.                    | High       | Package size increases. Native and browser text measurement use the same font data, and the demo has no external image dependency.           |
| Show a selected-code panel in the public demo.                                           | Expose the user's local Pi provider to the public website.      | High       | Hosts supply their own chat callback. Cherry retains its local provider integration. The website contains no model credentials.              |
| Keep the omitted tab prediction demo out of the UI.                                      | Add it during extraction.                                       | High       | This follows the user's request. Lower-level prediction support remains in the library.                                                      |
| Build the site in GitHub Actions and deploy a generated branch through Cloudflare.       | Compile Rust in Cloudflare's build environment.                 | High       | Cloudflare needs GitHub repository access. The generated branch is replaced only after verification passes.                                  |
| Test the default native, WebGPU, and WebGL paths with real renderers.                    | Treat unit tests or a framework fixture as proof of the editor. | High       | GPU tests need a graphics-capable machine. Platform rasterization can still differ.                                                          |
| Package macOS arm64 first.                                                               | Claim untested native platform support.                         | High       | Other native platforms need their own builds and application startup checks. The browser build is separate.                                  |

The browser runner now sets its viewport after navigation and asserts the size.
This fixes a test setup error that placed the hover target below the canvas. No
editor assertion was removed. WebGL checks disable only WebGPU adapter discovery
and then exercise the actual WebGL2 renderer.

The native application uses the existing public host/worker API. Its package
test runs a copied executable from an unrelated directory. The source package
test installs its archive into a separate project and checks the font assets,
public exports, host parts, and native editor.

I stand behind these implementation choices. Publication is complete only after
the full editor tests pass and the deployed site has been checked. Framework
fixture results alone do not establish that result.
