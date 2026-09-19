//! Run on the main OS thread. All windows stay off screen.
use gpui::{prelude::*, *};
use pierre_native_view::{Cell as TextCell, Row, Spec, Viewport, ViewportEvent};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

struct Panel {
    editor: Entity<Viewport>,
    scroll: ScrollHandle,
    wheels: Rc<Cell<usize>>,
}
impl Render for Panel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let wheels = self.wheels.clone();
        div()
            .id("outer")
            .size_full()
            .flex()
            .flex_col()
            .overflow_y_scroll()
            .restrict_scroll_to_axis()
            .track_scroll(&self.scroll)
            .on_scroll_wheel(move |_, _, _| wheels.set(wheels.get() + 1))
            .child(
                div()
                    .h(px(140.))
                    .w_full()
                    .flex_shrink_0()
                    .child(self.editor.clone()),
            )
            .child(div().h(px(1000.)).w_full().flex_shrink_0())
    }
}
fn spec(split: bool) -> Spec {
    let text = (0..40)
        .map(|i| format!("new line {i}"))
        .collect::<Vec<_>>()
        .join("\n");
    let old_text = text.replace("new", "old");
    let rows = text
        .split('\n')
        .enumerate()
        .map(|(i, text)| {
            let cell = |text: String, side: &str, color: &str| TextCell {
                text,
                number: Some(i + 1),
                start: Some(
                    (0..i)
                        .map(|j| format!("new line {j}\n").encode_utf16().count())
                        .sum(),
                ),
                side: side.into(),
                background: split.then(|| color.into()),
                ..Default::default()
            };
            Row {
                id: format!("row-{i}"),
                left: Some(cell(
                    if split {
                        text.replace("new", "old")
                    } else {
                        text.into()
                    },
                    if split { "deletions" } else { "additions" },
                    "#600000",
                )),
                right: split.then(|| cell(text.into(), "additions", "#006000")),
                ..Default::default()
            }
        })
        .collect();
    Spec {
        text,
        old_text,
        rows,
        split,
        session: 1,
        document_version: 1,
        ..Default::default()
    }
}
fn draw(cx: &mut VisualTestAppContext, window: AnyWindowHandle) {
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        let _ = window.draw(cx);
    })
    .unwrap();
    cx.run_until_parked();
}
fn wheel(cx: &mut VisualTestAppContext, window: AnyWindowHandle, dy: f32) -> DispatchEventResult {
    cx.simulate_mouse_move(window, point(px(100.), px(50.)), None, Modifiers::default());
    draw(cx, window);
    cx.update_window(window, |_, window, cx| {
        window.dispatch_event(
            ScrollWheelEvent {
                position: point(px(100.), px(50.)),
                delta: ScrollDelta::Pixels(point(px(0.), px(dy))),
                ..Default::default()
            }
            .to_platform_input(),
            cx,
        )
    })
    .unwrap()
}
fn main() -> anyhow::Result<()> {
    let mut cx = VisualTestAppContext::new(Rc::new(gpui_macos::MacPlatform::new(false)));
    let wheels = Rc::new(Cell::new(0));
    let window = cx.open_offscreen_window(size(px(600.), px(240.)), |window, cx| {
        cx.new(|cx| Panel {
            editor: cx.new(|cx| Viewport::new(spec(false), window, cx)),
            scroll: ScrollHandle::new(),
            wheels: wheels.clone(),
        })
    })?;
    let editor = window.update(&mut cx, |panel, _, _| panel.editor.clone())?;
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    let _subscription = cx.update(|cx| {
        cx.subscribe(&editor, move |_, event: &ViewportEvent, _| {
            sink.borrow_mut().push(event.0.clone())
        })
    });
    window.update(&mut cx, |panel, window, cx| {
        window.set_logical_active_for_tests(true);
        window.focus(&panel.editor.focus_handle(cx), cx);
    })?;
    draw(&mut cx, window.into());
    assert!(events.borrow().iter().any(|e| e["kind"] == "focus"));
    cx.simulate_input(window.into(), "z");
    assert!(events
        .borrow()
        .iter()
        .any(|e| e["kind"] == "insert" && e["text"] == "z"));
    let mut handler = cx.update_window(window.into(), |_, window, _| {
        window
            .take_input_handler_for_tests()
            .expect("native input handler")
    })?;
    handler.replace_and_mark_text_in_range(Some(0..3), "ni", Some(2..2));
    assert_eq!(handler.marked_text_range(), Some(0..2));
    assert!(editor.read_with(&cx, |view, _| view.snapshot().text.starts_with("ni line 0")));
    handler.replace_text_in_range(None, "你");
    assert_eq!(handler.marked_text_range(), None);
    cx.update_window(window.into(), |_, window, _| {
        window.restore_input_handler_for_tests(handler)
    })?;
    assert!(events
        .borrow()
        .iter()
        .any(|e| e["kind"] == "insert" && e["text"] == "你"));
    // The original external document model applies committed edits, not this viewport.
    assert!(editor.read_with(&cx, |view, _| view
        .snapshot()
        .text
        .starts_with("new line 0")));
    draw(&mut cx, window.into());
    let result = wheel(&mut cx, window.into(), -30.);
    assert!(
        result.propagate && result.default_prevented,
        "scroll consumption must preserve wheel observers"
    );
    assert_eq!(wheels.get(), 1, "ancestor wheel observer");
    assert_eq!(
        window.update(&mut cx, |panel, _, _| panel.scroll.offset().y)?,
        px(0.),
        "parent must not also move"
    );
    assert_eq!(
        editor.read_with(&cx, |view, _| view.snapshot().scroll_top),
        30.
    );
    wheel(&mut cx, window.into(), -10000.);
    wheel(&mut cx, window.into(), -30.);
    assert_eq!(wheels.get(), 3);
    assert_eq!(
        window.update(&mut cx, |panel, _, _| panel.scroll.offset().y)?,
        px(-30.),
        "wheel at editor boundary chains outward"
    );
    window.update(&mut cx, |panel, window, cx| {
        panel.scroll.set_offset(point(px(0.), px(0.)));
        panel.editor.update(cx, |view, cx| {
            let mut next = spec(true);
            next.session = 2;
            view.apply_spec(next, window, cx);
        });
        cx.notify();
    })?;
    draw(&mut cx, window.into());
    let screenshot = cx.capture_screenshot(window.into())?;
    screenshot.save("/tmp/pierre-shared-viewport.png")?;
    assert!(
        screenshot
            .pixels()
            .filter(|p| p[0] > 70 && p[1] < 30)
            .count()
            > 1000,
        "deletion background reaches GPU"
    );
    assert!(
        screenshot
            .pixels()
            .filter(|p| p[1] > 70 && p[0] < 30)
            .count()
            > 1000,
        "addition background reaches GPU"
    );
    assert!(
        screenshot
            .pixels()
            .filter(|p| p[0] > 150 && p[1] > 150 && p[2] > 150)
            .count()
            > 100,
        "glyphs reach GPU"
    );
    cx.update_window(window.into(), |_, window, _| window.remove_window())?;
    cx.run_until_parked();
    println!("PASS ordinary Pierre GPUI viewport: platform input, IME, scroll observers, boundary chaining, and split diff pixels");
    Ok(())
}
