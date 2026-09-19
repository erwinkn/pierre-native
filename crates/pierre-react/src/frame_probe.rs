//! Opt-in test component. Hidden/occluded windows have no display callbacks.
//! Force draws from the native executor to test painting without activating one.
use gpui_react_controls::ContainerProps;
use gpui_react_host::gpui_react::{
    Component, ReactChildren, ReactView, Registry,
    gpui::{prelude::*, *},
};
use std::time::Duration;
struct FrameProbe {
    children: Vec<AnyView>,
    task: Option<Task<()>>,
}
impl Render for FrameProbe {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.children.clone())
    }
}
impl ReactView for FrameProbe {
    type Props = ContainerProps;
    fn create(_: ContainerProps, _: &mut Window, _: &mut Context<Self>) -> Self {
        Self {
            children: vec![],
            task: None,
        }
    }
    fn set_props(&mut self, _: ContainerProps, _: &mut Window, _: &mut Context<Self>) {}
    fn mounted(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.task = Some(cx.spawn_in(window, async move |_, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(16))
                    .await;
                if cx.update(|window, cx| window.draw(cx).clear(cx)).is_err() {
                    break;
                }
            }
        }));
    }
    fn unmounting(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.task = None;
    }
}
impl ReactChildren for FrameProbe {
    fn set_children(&mut self, children: Vec<AnyView>, _: &mut Window, cx: &mut Context<Self>) {
        self.children = children;
        cx.notify();
    }
}
pub fn register(registry: &mut Registry) -> anyhow::Result<()> {
    registry.register(Component::<FrameProbe>::new("pierre-frame-probe").children())
}
