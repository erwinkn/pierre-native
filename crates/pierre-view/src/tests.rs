use super::*;
use gpui::{AppContext, TestAppContext};
use std::cell::{Cell as CountCell, RefCell};

fn spec(text: &str) -> Spec {
    let mut start = 0;
    let rows = text
        .split('\n')
        .enumerate()
        .map(|(i, text)| {
            let row = Row {
                id: format!("row-{i}"),
                left: Some(Cell {
                    text: text.into(),
                    number: Some(i + 1),
                    start: Some(start),
                    side: "additions".into(),
                    ..Default::default()
                }),
                ..Default::default()
            };
            start += text.encode_utf16().count() + 1;
            row
        })
        .collect();
    Spec {
        text: text.into(),
        rows,
        session: 1,
        document_version: 1,
        ..Default::default()
    }
}
fn draw(window: gpui::WindowHandle<Viewport>, cx: &mut TestAppContext) {
    cx.update_window(window.into(), |_, window, cx| window.draw(cx).clear(cx))
        .unwrap();
    cx.run_until_parked();
}
#[test]
fn utf16_boundaries() {
    let text = "a🙂e\u{301}中";
    assert_eq!(byte_at(text, 3), 5);
    assert_eq!(units_at(text, 5), 3);
    assert_eq!(byte_at(text, 99), text.len());
}
#[gpui::test]
fn one_spec_owner_and_native_render(cx: &mut TestAppContext) {
    let initial = spec("first\nsecond");
    let text = initial.text.as_ptr();
    let rows = initial.rows.as_ptr();
    let window = cx.add_window(|window, cx| Viewport::new(initial, window, cx));
    window
        .update(cx, |view, _, _| {
            assert_eq!(view.spec.text.as_ptr(), text);
            assert_eq!(view.spec.rows.as_ptr(), rows);
        })
        .unwrap();
    let painted = Rc::new(RefCell::new(Vec::new()));
    let sink = painted.clone();
    window
        .update(cx, |view, _, _| {
            view.set_paint_observer(Some(Rc::new(move |text| {
                sink.borrow_mut().push(text.to_string())
            })))
        })
        .unwrap();
    draw(window, cx);
    assert!(painted.borrow().iter().any(|text| text == "first"));
    assert!(painted.borrow().iter().any(|text| text == "second"));
    window
        .update(cx, |view, _, _| {
            assert!(view.paint_count > 0);
            assert_eq!(view.painted_document_version, 1);
            assert!(view.bounds.size.width > px(0.));
        })
        .unwrap();
}
#[gpui::test]
fn native_input_events_keep_payload_and_sequence(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("abc"), window, cx));
    let view = window.update(cx, |_, _, cx| cx.entity()).unwrap();
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    let _subscription = cx.update(|cx| {
        cx.subscribe(&view, move |_, event: &ViewportEvent, _| {
            sink.borrow_mut().push(event.0.clone())
        })
    });
    let start_seq = window
        .update(cx, |view, window, cx| {
            let start_seq = view.seq;
            view.set_selected_text_range(1..2, window, cx);
            view.replace_text_in_range(None, "é", window, cx);
            start_seq
        })
        .unwrap();
    cx.run_until_parked();
    let events = events.borrow();
    assert_eq!(
        events[0],
        json!({"kind":"select","anchor":1,"head":2,"seq":start_seq+1,"documentVersion":1})
    );
    assert_eq!(
        events[1],
        json!({"kind":"insert","text":"é","seq":start_seq+2,"documentVersion":1})
    );
    window
        .update(cx, |view, _, _| {
            assert_eq!(
                view.spec.text, "abc",
                "the external document model applies committed edits"
            )
        })
        .unwrap();
}
#[gpui::test]
fn stale_view_ack_cannot_replace_new_native_selection(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("abcdef"), window, cx));
    window
        .update(cx, |view, window, cx| {
            view.set_selected_text_range(2..4, window, cx);
            let state = ViewState {
                session: 1,
                selections: vec![Selection {
                    anchor: 0,
                    head: 0,
                    ..Default::default()
                }],
                ..Default::default()
            };
            view.apply_update(
                Update {
                    view: Some(state.clone()),
                    ..Default::default()
                },
                window,
                cx,
            );
            assert_eq!(view.range(), 2..4);
            view.apply_update(
                Update {
                    view: Some(ViewState {
                        ack: view.seq,
                        ..state
                    }),
                    ..Default::default()
                },
                window,
                cx,
            );
            assert_eq!(view.range(), 0..0);
        })
        .unwrap();
}
#[gpui::test]
fn patch_chain_is_ordered_and_duplicate_safe(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("a\nb"), window, cx));
    let patch = json!({"chain":[
        {"base":1,"version":2,"start":0,"deleteCount":1,"rows":[{"id":"changed","left":{"text":"A","number":1,"start":0,"side":"additions"}}],"textEdit":{"start":0,"end":1,"text":"A"}},
        {"base":2,"version":3,"start":1,"deleteCount":1,"rows":[{"id":"changed-2","left":{"text":"B","number":2,"start":2,"side":"additions"}}],"text":"A\nB"}
    ]});
    window.update(cx,|view,window,cx|{
        for _ in 0..2 {view.apply_update(Update{patch:Some(patch.clone()),..Default::default()},window,cx);}
        assert_eq!(view.spec.document_version,3);assert_eq!(view.spec.text,"A\nB");assert_eq!(view.spec.rows.len(),2);
        view.apply_update(Update{patch:Some(json!({"base":1,"version":5,"start":0,"deleteCount":2,"rows":[],"text":"stale"})),..Default::default()},window,cx);
        assert_eq!(view.spec.document_version,3);assert_eq!(view.spec.text,"A\nB");
    }).unwrap();
    draw(window, cx);
    window
        .update(cx, |view, _, _| {
            assert_eq!(view.painted_document_version, 3)
        })
        .unwrap();
}
struct Slot {
    height: f32,
    bounds: Rc<CountCell<Bounds<Pixels>>>,
}
impl gpui::Render for Slot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let bounds = self.bounds.clone();
        div()
            .w_full()
            .h(px(self.height))
            .on_painted(move |area, _, _| bounds.set(area))
    }
}
#[gpui::test]
fn native_annotation_children_measure_and_resize_in_the_same_layout(cx: &mut TestAppContext) {
    let mut initial = spec("line");
    initial.rows.insert(
        0,
        Row {
            id: "annotation".into(),
            slot: Some(0),
            kind: "annotation".into(),
            ..Default::default()
        },
    );
    let window = cx.add_window(|window, cx| Viewport::new(initial, window, cx));
    let bounds = Rc::new(CountCell::new(Bounds::default()));
    let slot = cx.new(|_| Slot {
        height: 30.,
        bounds: bounds.clone(),
    });
    window
        .update(cx, |view, _, cx| {
            view.set_children(vec![slot.clone().into()], cx)
        })
        .unwrap();
    draw(window, cx);
    assert_eq!(bounds.get().size.height, px(30.));
    window
        .update(cx, |view, _, _| assert_eq!(view.tops[1], 30.))
        .unwrap();
    slot.update(cx, |slot, cx| {
        slot.height = 60.;
        cx.notify();
    });
    draw(window, cx);
    assert_eq!(bounds.get().size.height, px(60.));
    window
        .update(cx, |view, _, _| assert_eq!(view.tops[1], 60.))
        .unwrap();
}
#[gpui::test]
fn switching_documents_during_ime_cannot_restore_rows_from_the_old_document(
    cx: &mut TestAppContext,
) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("a\nb\nc"), window, cx));
    window
        .update(cx, |view, window, cx| {
            view.replace_and_mark_text_in_range(Some(4..5), "ni", Some(2..2), window, cx);
            assert!(view.marked.is_some());
            let mut next = spec("new");
            next.session = 2;
            view.apply_spec(next, window, cx);
            view.unmark_text(window, cx);
            assert_eq!(view.spec.text, "new");
            assert_eq!(view.spec.rows.len(), 1);
            assert!(view.marked.is_none());
        })
        .unwrap();
}

#[gpui::test]
fn replacing_source_in_the_same_session_cancels_old_composition(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("a\nb\nc"), window, cx));
    window
        .update(cx, |view, window, cx| {
            view.replace_and_mark_text_in_range(Some(4..5), "ni", Some(2..2), window, cx);
            let mut next = spec("new");
            next.document_version = 2;
            view.apply_spec(next, window, cx);
            view.unmark_text(window, cx);
            assert_eq!(view.spec.text, "new");
            assert_eq!(view.spec.rows.len(), 1);
            assert!(view.marked.is_none());
        })
        .unwrap();
}
#[gpui::test]
fn source_patch_during_composition_cannot_restore_old_rows(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("a\nb\nc"), window, cx));
    window.update(cx, |view, window, cx| {
        view.replace_and_mark_text_in_range(Some(4..5), "ni", Some(2..2), window, cx);
        view.apply_update(Update{patch:Some(json!({"base":1,"version":2,"start":0,"deleteCount":3,"rows":[{"id":"new","left":{"text":"new","start":0,"side":"additions"}}],"text":"new"})),..Default::default()},window,cx);
        view.unmark_text(window,cx);
        assert_eq!(view.spec.text,"new"); assert_eq!(view.spec.rows.len(),1); assert!(view.marked.is_none());
    }).unwrap();
}
#[gpui::test]
fn same_source_presentation_update_rebuilds_composition_backups(cx: &mut TestAppContext) {
    let window = cx.add_window(|window, cx| Viewport::new(spec("a\nb\nc"), window, cx));
    window
        .update(cx, |view, window, cx| {
            view.replace_and_mark_text_in_range(Some(4..5), "ni", Some(1..2), window, cx);
            let mut next = spec("a\nb\nc");
            next.font_size = 18.;
            next.rows.insert(
                0,
                Row {
                    id: "header".into(),
                    label: Some("annotation".into()),
                    ..Default::default()
                },
            );
            view.apply_spec(next, window, cx);
            assert_eq!(view.text(), "a\nb\nni");
            assert_eq!(view.marked, Some(4..6));
            assert_eq!(view.range(), 5..6);
            assert_eq!(view.spec.rows[3].left.as_ref().unwrap().text, "ni");
            view.unmark_text(window, cx);
            assert_eq!(view.spec.rows[2].left.as_ref().unwrap().text, "b");
            assert_eq!(view.spec.rows[3].left.as_ref().unwrap().text, "c");
        })
        .unwrap();
}
