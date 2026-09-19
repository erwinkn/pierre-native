//! Update payloads. The viewport is the sole owner of the live specification.
use super::*;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ViewState {
    pub selections: Vec<Selection>,
    pub decorations: Vec<Selection>,
    pub predictions: Vec<Prediction>,
    pub active_owner: String,
    pub focus_request: u64,
    pub session: u64,
    pub reset_session_scroll: bool,
    pub revision: u64,
    pub ack: u64,
    pub reveal: u64,
    pub scroll_request: u64,
    pub scroll_top: f32,
    pub scroll_left: f32,
}
impl Default for ViewState {
    fn default() -> Self {
        Self {
            selections: vec![],
            decorations: vec![],
            predictions: vec![],
            active_owner: String::new(),
            focus_request: 0,
            session: 0,
            reset_session_scroll: true,
            revision: 0,
            ack: 0,
            reveal: 0,
            scroll_request: 0,
            scroll_top: 0.,
            scroll_left: 0.,
        }
    }
}
impl ViewState {
    fn take_from(spec: &mut Spec) -> Self {
        Self {
            selections: std::mem::take(&mut spec.selections),
            decorations: std::mem::take(&mut spec.decorations),
            predictions: std::mem::take(&mut spec.predictions),
            active_owner: std::mem::take(&mut spec.active_owner),
            focus_request: std::mem::take(&mut spec.focus_request),
            session: std::mem::take(&mut spec.session),
            reset_session_scroll: std::mem::take(&mut spec.reset_session_scroll),
            revision: std::mem::take(&mut spec.revision),
            ack: std::mem::take(&mut spec.ack),
            reveal: std::mem::take(&mut spec.reveal),
            scroll_request: std::mem::take(&mut spec.scroll_request),
            scroll_top: std::mem::take(&mut spec.scroll_top),
            scroll_left: std::mem::take(&mut spec.scroll_left),
        }
    }
    pub(crate) fn write_into(self, spec: &mut Spec) {
        spec.selections = self.selections;
        spec.decorations = self.decorations;
        spec.predictions = self.predictions;
        spec.active_owner = self.active_owner;
        spec.focus_request = self.focus_request;
        spec.session = self.session;
        spec.reset_session_scroll = self.reset_session_scroll;
        spec.revision = self.revision;
        spec.ack = self.ack;
        spec.reveal = self.reveal;
        spec.scroll_request = self.scroll_request;
        spec.scroll_top = self.scroll_top;
        spec.scroll_left = self.scroll_left;
    }
    #[cfg(feature = "legacy")]
    pub(crate) fn legacy(value: &Value) -> Self {
        Self {
            selections: serde_json::from_value(value["selections"].clone()).unwrap_or_default(),
            decorations: serde_json::from_value(value["decorations"].clone()).unwrap_or_default(),
            predictions: serde_json::from_value(value["predictions"].clone()).unwrap_or_default(),
            active_owner: value["activeOwner"].as_str().unwrap_or("").to_owned(),
            focus_request: value["focusRequest"].as_u64().unwrap_or(0),
            session: value["session"].as_u64().unwrap_or(0),
            reset_session_scroll: value["resetSessionScroll"].as_bool().unwrap_or(true),
            revision: value["revision"].as_u64().unwrap_or(0),
            ack: value["ack"].as_u64().unwrap_or(0),
            reveal: value["reveal"].as_u64().unwrap_or(0),
            scroll_request: value["scrollRequest"].as_u64().unwrap_or(0),
            scroll_top: value["scrollTop"].as_f64().unwrap_or(0.) as f32,
            scroll_left: value["scrollLeft"].as_f64().unwrap_or(0.) as f32,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Update {
    pub spec: Option<Spec>,
    pub view: Option<ViewState>,
    pub patch: Option<Value>,
}
impl Viewport {
    pub fn apply_update(&mut self, update: Update, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(mut spec) = update.spec {
            if let Some(view) = update.view {
                view.write_into(&mut spec);
            }
            self.apply_spec(spec, window, cx);
        } else if let Some(view) = update.view {
            if view.ack >= self.seq
                || view.revision != self.spec.revision
                || view.session != self.spec.session
            {
                if view.session != self.spec.session {
                    self.take_composition_preview();
                }
                self.prepare_view(&view, false, self.spec.read_only, window);
                view.write_into(&mut self.spec);
                cx.notify();
            }
        }
        if let Some(patch) = update.patch {
            self.apply_patch(&patch, window, cx);
        }
    }
    pub fn apply_spec(&mut self, mut spec: Spec, window: &mut Window, cx: &mut Context<Self>) {
        let same_source = spec.session == self.spec.session && spec.text == self.spec.text;
        let preview = self.take_composition_preview().filter(|_| same_source);
        let reset = spec.font_family != self.spec.font_family
            || spec.font_size != self.spec.font_size
            || spec.tab_size != self.spec.tab_size
            || spec.wrap != self.spec.wrap
            || spec.gutter != self.spec.gutter
            || spec.line_height != self.spec.line_height
            || spec.split != self.spec.split;
        self.remember_anchor();
        if reset {
            self.layouts.clear();
            self.width = 0.;
        }
        let view = ViewState::take_from(&mut spec);
        self.prepare_view(&view, true, spec.read_only, window);
        view.write_into(&mut spec);
        self.spec = spec;
        self.accessible_value = self.spec.text.clone().into();
        self.resume_composition_preview(preview, window, cx);
        self.dirty = true;
        cx.notify();
    }
    fn prepare_view(
        &mut self,
        view: &ViewState,
        content_changed: bool,
        read_only: bool,
        window: &mut Window,
    ) {
        if (view.scroll_request != self.spec.scroll_request
            && (view.session == self.spec.session || view.reset_session_scroll))
            || (view.session != self.spec.session && view.reset_session_scroll)
        {
            self.scroll_anchor = None;
            self.scroll_top = view.scroll_top;
            self.scroll_left = view.scroll_left;
        }
        if view.focus_request > self.last_focus_request {
            self.last_focus_request = view.focus_request;
            self.side = "additions".into();
            if !read_only {
                window.request_text_input();
            }
        }
        if self.side != "deletions"
            || content_changed
            || view.reveal != self.spec.reveal
            || view.session != self.spec.session
        {
            if let Some(selection) = view.selections.last() {
                self.anchor = selection.anchor;
                self.head = selection.head;
            }
        }
        if view.predictions != self.spec.predictions || view.active_owner != self.spec.active_owner
        {
            self.remember_anchor();
            self.dirty = true;
        }
        let reveal = view.reveal != self.spec.reveal;
        self.reveal_pending |= reveal;
        if reveal {
            self.side = "additions".into();
        }
    }
    fn apply_patch(&mut self, patch: &Value, window: &mut Window, cx: &mut Context<Self>) {
        let pending: &[Value] = patch["chain"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_else(|| std::slice::from_ref(patch));
        for patch in pending {
            if let (Some(base), Some(version)) = (patch["base"].as_u64(), patch["version"].as_u64())
            {
                if version > self.spec.document_version && base == self.spec.document_version {
                    let start = patch["start"].as_u64().unwrap_or(0) as usize;
                    let count = patch["deleteCount"].as_u64().unwrap_or(0) as usize;
                    if start <= self.spec.rows.len() && count <= self.spec.rows.len() - start {
                        if let Ok(rows) = serde_json::from_value::<Vec<Row>>(patch["rows"].clone())
                        {
                            let preview = self.take_composition_preview();
                            let mut text_changed = false;
                            self.remember_anchor();
                            if let Some((_, index, _)) = self.scroll_anchor.as_mut() {
                                if *index >= start + count {
                                    *index = (*index as isize + rows.len() as isize
                                        - count as isize)
                                        .max(0)
                                        as usize;
                                }
                            }
                            let tail = start + rows.len();
                            self.spec.rows.splice(start..start + count, rows);
                            for row in &mut self.spec.rows[tail..] {
                                for cell in [&mut row.left, &mut row.right].into_iter().flatten() {
                                    let shift = &patch["shift"][&cell.side];
                                    if let Some(offset) = cell.start {
                                        cell.start = Some(
                                            (offset as i64 + shift[0].as_i64().unwrap_or(0)).max(0)
                                                as usize,
                                        );
                                    }
                                    if let Some(number) = cell.number {
                                        cell.number = Some(
                                            (number as i64 + shift[1].as_i64().unwrap_or(0)).max(0)
                                                as usize,
                                        );
                                    }
                                }
                            }
                            if let (Some(start), Some(end), Some(text)) = (
                                patch["textEdit"]["start"].as_u64(),
                                patch["textEdit"]["end"].as_u64(),
                                patch["textEdit"]["text"].as_str(),
                            ) {
                                let a = byte_at(&self.spec.text, start as usize);
                                let b = byte_at(&self.spec.text, end as usize);
                                if a <= b {
                                    text_changed |= &self.spec.text[a..b] != text;
                                    self.spec.text.replace_range(a..b, text);
                                    self.accessible_value = self.spec.text.clone().into();
                                }
                            }
                            if let Some(text) = patch["text"].as_str() {
                                text_changed |= self.spec.text != text;
                                self.spec.text = text.to_owned();
                                self.accessible_value = self.spec.text.clone().into();
                            }
                            if let Some(text) = patch["oldText"].as_str() {
                                self.spec.old_text = text.to_owned();
                            }
                            self.spec.document_version = version;
                            self.resume_composition_preview(
                                preview.filter(|_| !text_changed),
                                window,
                                cx,
                            );
                            self.dirty = true;
                            cx.notify();
                        }
                    }
                }
            }
        }
    }
}
