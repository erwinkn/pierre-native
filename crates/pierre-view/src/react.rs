//! Opt-in typed binding. Implemented beside Viewport to avoid an extra wrapper
//! entity and a second event relay. The default GPUI view has no bridge dependency.
use super::*;
use gpui_react::{
    Component, FrameInfo, ReactChildren, ReactCommands, ReactEvents, ReactQueries, ReactView,
    Registry,
};
use gpui_react_controls::Style;
use serde::Deserialize;

#[derive(Default)]
pub(crate) struct State {
    pub style: Style,
    pub label: String,
    pub frame: Option<FrameInfo>,
}
#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Props {
    pub initial_spec: Spec,
    pub style: Style,
    pub label: String,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Update {
        #[serde(flatten)]
        update: Update,
    },
    Focus,
    Blur,
}
#[derive(Serialize)]
pub struct Reply {
    #[serde(flatten)]
    pub viewport: ViewportSnapshot,
    pub frame: Option<FrameInfo>,
    pub focused: bool,
}
impl ReactView for Viewport {
    type Props = Props;
    fn create(props: Props, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut view = Self::new(props.initial_spec, window, cx);
        view.react.style = props.style;
        view.react.label = props.label;
        view
    }
    fn set_props(&mut self, props: Props, _: &mut Window, cx: &mut Context<Self>) {
        self.react.style = props.style;
        self.react.label = props.label;
        cx.notify();
    }
    fn unmounting(&mut self, window: &mut Window, _: &mut Context<Self>) {
        self.shutdown(window);
    }
}
impl ReactEvents for Viewport {
    type Event = ViewportEvent;
}
impl ReactCommands for Viewport {
    type Command = Command;
    fn command(
        &mut self,
        command: Command,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        match command {
            Command::Update { update } => self.apply_update(update, window, cx),
            Command::Focus => window.focus(&self.focus, cx),
            Command::Blur => {
                if self.focus.is_focused(window) {
                    window.blur();
                }
            }
        }
        Ok(())
    }
}
impl ReactQueries for Viewport {
    type Query = ();
    type Reply = Reply;
    fn query(
        &mut self,
        _: (),
        window: &mut Window,
        _: &mut Context<Self>,
    ) -> anyhow::Result<Reply> {
        Ok(Reply {
            viewport: self.snapshot(),
            frame: self.react.frame,
            focused: self.focus.is_focused(window),
        })
    }
}
impl ReactChildren for Viewport {
    fn set_children(
        &mut self,
        children: Vec<gpui::AnyView>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        Viewport::set_children(self, children, cx);
    }
}
pub fn register(registry: &mut Registry) -> anyhow::Result<()> {
    registry.register(
        Component::<Viewport>::new("pierre-viewport")
            .children()
            .events()
            .commands()
            .queries(),
    )
}

#[cfg(test)]
mod tests {
    use super::{register, Command};
    use crate::Viewport;
    use gpui::{AppContext, EntityInputHandler, TestAppContext};
    use gpui_react::{Emission, Host, Registry};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    #[test]
    fn command_accepts_existing_update_payloads() {
        let command:Command=serde_json::from_value(json!({"type":"update","view":{"ack":3,"session":1},"patch":{"base":1,"version":2,"rows":[]}})).unwrap();
        let Command::Update { update } = command else {
            panic!("wrong variant")
        };
        assert_eq!(update.view.unwrap().ack, 3);
        assert_eq!(update.patch.unwrap()["version"], 2);
    }
    #[gpui::test]
    fn ordinary_view_uses_host_frames_and_retains_queued_events_on_removal(
        cx: &mut TestAppContext,
    ) {
        let events: Arc<Mutex<Vec<Emission>>> = Arc::new(Mutex::new(vec![]));
        let sink = events.clone();
        let window = cx.add_window(|_, _| {
            let mut registry = Registry::default();
            register(&mut registry).unwrap();
            Host::new(
                registry,
                Arc::new(move |event| sink.lock().unwrap().push(event)),
            )
        });
        window.update(cx,|host,window,cx|host.apply(serde_json::from_value(json!({"version":1,"sequence":1,"operations":[
            {"op":"create","id":1,"component":"pierre-viewport","subscription":1,"props":{"initialSpec":{"text":"abc","session":1,"documentVersion":1,"rows":[{"id":"line","left":{"text":"abc","number":1,"start":0,"side":"additions"}}]}}},
            {"op":"place","child":1,"parent":null,"before":null}
        ]})).unwrap(),window,cx).unwrap()).unwrap();
        cx.update_window(window.into(), |_, window, cx| window.draw(cx).clear(cx))
            .unwrap();
        cx.run_until_parked();
        let snapshot=window.update(cx,|host,window,cx|host.apply(serde_json::from_value(json!({"version":1,"sequence":2,"operations":[{"op":"query","id":1,"request":1,"value":null}]})).unwrap(),window,cx).unwrap()).unwrap();
        let reply = snapshot.results[0].value.as_ref().unwrap();
        assert_eq!(reply["text"], "abc");
        assert_eq!(reply["paintedDocumentVersion"], 1);
        assert!(reply["frame"]["root"].is_string());
        events.lock().unwrap().clear();
        window
            .update(cx, |host, window, cx| {
                let entity = host
                    .view(1)
                    .unwrap()
                    .clone()
                    .downcast::<Viewport>()
                    .unwrap();
                entity.update(cx, |view, cx| {
                    view.replace_text_in_range(None, "z", window, cx)
                });
                host.apply(
                    serde_json::from_value(
                        json!({"version":1,"sequence":3,"operations":[{"op":"remove","id":1}]}),
                    )
                    .unwrap(),
                    window,
                    cx,
                )
                .unwrap();
            })
            .unwrap();
        cx.run_until_parked();
        let events = events.lock().unwrap();
        let insert = events
            .iter()
            .find(|event| {
                event
                    .payload
                    .as_ref()
                    .ok()
                    .and_then(|value| value.get("kind"))
                    == Some(&Value::String("insert".into()))
            })
            .expect("queued viewport event was lost at removal");
        assert_eq!(insert.payload.as_ref().unwrap()["text"], "z");
    }
}
