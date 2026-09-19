//! Compatibility adapter for the existing native and browser renderer.
use super::*;
use gpuix_native::extension::{
    self as host, NativeElement, NativeElementFactory, NativeRenderContext,
};
use std::cell::RefCell;

struct Factory;
impl NativeElementFactory for Factory {
    fn element_type(&self) -> &str {
        "pierre-viewport"
    }
    fn create(&self, _: u64) -> Box<dyn NativeElement> {
        Box::new(Adapter::default())
    }
}
#[derive(Default)]
struct Adapter {
    state: Option<Entity<Viewport>>,
    pending_spec: Option<Spec>,
    // Legacy props remain declared until changed. Keep only the small view
    // payload and latest patch; the viewport owns the full live specification.
    view: Option<ViewState>,
    patch: Value,
    changed: bool,
    callback: Rc<RefCell<Option<host::EventCallback>>>,
}
impl NativeElement for Adapter {
    fn set_prop(&mut self, key: &str, value: Value) {
        match key {
            "spec" => {
                let parsed = if let Some(text) = value.as_str() {
                    serde_json::from_str(text)
                } else {
                    serde_json::from_value(value)
                };
                if let Ok(spec) = parsed {
                    self.pending_spec = Some(spec);
                    self.changed = true;
                }
            }
            "view" => {
                self.view = (!value.is_null()).then(|| ViewState::legacy(&value));
                self.changed = true;
            }
            "patch" => {
                self.patch = value
                    .as_str()
                    .map(|text| serde_json::from_str(text).unwrap_or(Value::Null))
                    .unwrap_or(value);
                self.changed = true;
            }
            _ => {}
        }
    }
    fn supported_props(&self) -> &'static [&'static str] {
        &["spec", "view", "patch"]
    }
    fn supported_events(&self) -> &'static [&'static str] {
        &["change", "focus", "blur", "keyDown"]
    }
    fn destroy(&mut self) {
        self.state = None;
    }
    fn render(
        &mut self,
        ctx: NativeRenderContext,
        window: &mut Window,
        cx: &mut Context<host::NativeView>,
    ) -> gpui::AnyElement {
        let focus = ctx
            .focus_handle
            .cloned()
            .unwrap_or_else(|| cx.focus_handle());
        *self.callback.borrow_mut() = ctx.event_callback.clone();
        if self.state.is_none() {
            let state =
                cx.new(|cx| Viewport::with_focus(Spec::default(), focus.clone(), window, cx));
            state.update(cx, |state, _| {
                state.set_paint_observer(Some(Rc::new(host::log_painted_text)))
            });
            cx.observe(&state, |_, _, cx| cx.notify()).detach();
            let callback = self.callback.clone();
            let id = ctx.id;
            cx.subscribe(&state, move |_, _, event: &ViewportEvent, _| {
                host::emit_event_full(&callback.borrow(), id, "change", |payload| {
                    payload.value = Some(event.0.to_string())
                });
            })
            .detach();
            self.state = Some(state);
        }
        let state = self.state.as_ref().unwrap();
        if self.changed {
            let update = Update {
                spec: self.pending_spec.take(),
                view: self.view.clone(),
                patch: Some(self.patch.clone()),
            };
            state.update(cx, |state, cx| state.apply_update(update, window, cx));
            self.changed = false;
        }
        let content = state.update(cx, |state, cx| state.render_view(ctx.children, window, cx));
        let mut root = div()
            .relative()
            .id(SharedString::from(format!("pierre-{}", ctx.id)))
            .w_full()
            .h_full()
            .min_w_0()
            .min_h_0()
            .track_focus(&focus)
            .child(content);
        if let Some(style) = ctx.style {
            root = host::apply_interactive_styles(root, style);
        }
        root = host::apply_accessibility(root, ctx.props, Some(gpui::Role::MultilineTextInput));
        root.aria_value(state.read(cx).accessible_value.clone())
            .child(host::bounds_tracker(ctx.id, Some(false)))
            .into_any_element()
    }
}
pub fn register() -> Result<(), String> {
    host::register_extension(host::NativeExtension {
        id: "pierre-native",
        version: env!("CARGO_PKG_VERSION"),
        api_version: host::NATIVE_EXTENSION_API_VERSION,
        elements: &[host::NativeElementRegistration {
            name: "pierre-viewport",
            factory: || Box::new(Factory),
        }],
    })
}
