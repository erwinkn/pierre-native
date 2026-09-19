//! Opt-in native composition. The default Pierre runtime keeps its legacy API.
pub use gpui_react_host::*;
#[cfg(feature = "frame-probe")]
mod frame_probe;

#[napi_derive::module_init]
fn initialize() {
    register_components(|registry| {
        gpui_react_controls::register(registry)?;
        #[cfg(feature = "frame-probe")]
        frame_probe::register(registry)?;
        pierre_native_view::react::register(registry)
    });
}
