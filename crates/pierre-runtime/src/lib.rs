//! The demo links one GPUiX core and the Pierre viewport into one runtime.
pub use gpuix_native::*;

#[cfg(not(target_family = "wasm"))]
#[napi_derive::module_init]
fn register_components() {
    pierre_native_view::register().expect("valid Pierre viewport registration");
}

#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn register_components() -> Result<(), wasm_bindgen::JsValue> {
    pierre_native_view::register().map_err(|message| message.into())
}
