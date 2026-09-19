//! Native code/diff viewport. The host owns Pierre's document model; GPUI owns
//! shaping, hit testing, scrolling, input-method geometry, and GPU painting.
// Native viewport adapted from the GPUIX Pierre port in Cherry.
// Copyright 2026 Erwin Kuhn. Licensed under Apache-2.0.
pub use gpui;
use gpui::{
    div, fill, point, prelude::*, px, relative, size, App, Bounds, ClipboardItem, Context,
    CursorStyle, DispatchPhase, ElementInputHandler, Entity, EntityInputHandler, FocusHandle,
    GlobalElementId, Hsla, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    Pixels, Point, ScrollWheelEvent, SharedString, Style, Task, TextRun, UTF16Selection, Window,
    WrappedLine,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    ops::Range,
    rc::Rc,
    sync::Arc,
    time::Duration,
};
use unicode_segmentation::UnicodeSegmentation;

mod model;
pub use model::*;
mod update;
pub use update::{Update, ViewState};
#[cfg(feature = "legacy")]
mod legacy;
#[cfg(feature = "legacy")]
pub use legacy::register;
#[cfg(feature = "react")]
pub mod react;

#[derive(Clone, Serialize)]
#[serde(transparent)]
pub struct ViewportEvent(pub Value);
impl gpui::EventEmitter<ViewportEvent> for Viewport {}

fn color(s: &str) -> Hsla {
    csscolorparser::parse(s)
        .ok()
        .map(|c| {
            let c = c.clamp();
            gpui::Rgba {
                r: c.r,
                g: c.g,
                b: c.b,
                a: c.a,
            }
            .into()
        })
        .unwrap_or_else(|| gpui::rgba(0x00000000).into())
}
fn byte_at(text: &str, offset: usize) -> usize {
    let mut units = 0;
    for (i, c) in text.char_indices() {
        if units >= offset {
            return i;
        }
        units += c.len_utf16();
    }
    text.len()
}
fn units_at(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].encode_utf16().count()
}

struct ShapedCell {
    line: WrappedLine,
    display: String,
    map: Vec<(usize, usize)>,
    height: f32,
    width: f32,
    key: String,
}
// CSS pre-wrap uses Unicode line opportunities, with grapheme fallback for an
// overlong word. GPUI's default wrapper also breaks before punctuation, which
// changes code rows. Keep its shaped glyph positions and replace only breaks.
fn wrap_code_line(mut line: WrappedLine, width: Pixels) -> WrappedLine {
    let opportunities: HashSet<usize> = unicode_linebreak::linebreaks(&line.text)
        .map(|(index, _)| index)
        // Browser ASCII line breaking keeps path segments after a solidus
        // together. Unicode's general rule allows a break there.
        .filter(|&index| {
            index == 0
                || index == line.text.len()
                || !(line.text.as_bytes()[index - 1] == b'/'
                    && line.text.as_bytes()[index].is_ascii_alphanumeric())
        })
        .collect();
    let graphemes: HashSet<usize> = line.text.grapheme_indices(true).map(|(i, _)| i).collect();
    let mut glyphs = Vec::new();
    for (run_ix, run) in line.unwrapped_layout.runs.iter().enumerate() {
        for (glyph_ix, glyph) in run.glyphs.iter().enumerate() {
            if graphemes.contains(&glyph.index)
                && glyphs
                    .last()
                    .is_none_or(|(_, index, _)| *index != glyph.index)
            {
                glyphs.push((
                    gpui::WrapBoundary { run_ix, glyph_ix },
                    glyph.index,
                    glyph.position.x,
                ));
            }
        }
    }
    let mut boundaries = Vec::new();
    let mut start = 0;
    let mut candidate = None;
    let mut i = 0;
    while i < glyphs.len() {
        let (_, byte, _) = glyphs[i];
        if i > start && opportunities.contains(&byte) {
            candidate = Some(i);
        }
        let next_x = glyphs
            .get(i + 1)
            .map_or(line.unwrapped_layout.width, |g| g.2);
        // Preserved trailing spaces hang outside the line in CSS pre-wrap.
        let hanging_space = line.text[byte..].chars().next() == Some(' ');
        if !hanging_space && next_x - glyphs[start].2 > width && i > start {
            let next = candidate.take().filter(|c| *c > start).unwrap_or(i);
            boundaries.push(glyphs[next].0);
            start = next;
            i = next;
        } else {
            i += 1;
        }
    }
    *line = Arc::new(gpui::WrappedLineLayout {
        unwrapped_layout: line.unwrapped_layout.clone(),
        wrap_boundaries: boundaries.into_iter().collect(),
        wrap_width: Some(width),
    });
    line
}
impl ShapedCell {
    // The DOM caret at a wrap boundary belongs to the next visual line.
    // GPUI's general text API uses the preceding line at the same byte index.
    fn position_for_index(&self, byte: usize, line_height: Pixels) -> Option<Point<Pixels>> {
        for (i, boundary) in self.line.wrap_boundaries.iter().enumerate() {
            let glyph = &self.line.unwrapped_layout.runs[boundary.run_ix].glyphs[boundary.glyph_ix];
            if glyph.index == byte {
                return Some(point(px(0.), line_height * (i + 1)));
            }
        }
        self.line.position_for_index(byte, line_height)
    }
    fn byte_for_units(&self, units: usize) -> usize {
        self.map
            .iter()
            .find(|(_, u)| *u >= units)
            .map(|(b, _)| *b)
            .unwrap_or(self.display.len())
    }
    fn units_for_byte(&self, byte: usize) -> usize {
        self.map
            .iter()
            .rev()
            .find(|(b, _)| *b <= byte)
            .map(|(_, u)| *u)
            .unwrap_or(0)
    }
}
pub struct Viewport {
    accessible_value: SharedString,
    spec: Spec,
    focus: FocusHandle,
    children: Vec<gpui::AnyView>,
    paint_observer: Option<Rc<dyn Fn(SharedString)>>,
    paint_count: u64,
    painted_document_version: u64,
    #[cfg(feature = "react")]
    react: react::State,
    seq: u64,
    scroll_top: f32,
    scroll_left: f32,
    scroll_anchor: Option<(String, usize, f32)>,
    bounds: Bounds<Pixels>,
    layouts: HashMap<(usize, bool), ShapedCell>,
    tops: Vec<f32>,
    heights: Vec<f32>,
    width: f32,
    total_height: f32,
    content_width: f32,
    anchor: usize,
    head: usize,
    side: String,
    last_focus_request: u64,
    dragging: bool,
    drag_alt: bool,
    drag_origin: Option<Point<Pixels>>,
    drag_gutter: bool,
    drag_point: Option<Point<Pixels>>,
    drag_task: Option<Task<()>>,
    marked: Option<Range<usize>>,
    composition: Option<(Range<usize>, String)>,
    composition_text: Option<String>,
    composition_rows: Vec<(usize, Row)>,
    blink: Option<Task<()>>,
    blink_on: bool,
    prediction_shown: bool,
    alt_pressed: bool,
    reveal_pending: bool,
    dirty: bool,
    annotation_heights: HashMap<usize, f32>,
    hover_hit: Option<(usize, bool, usize)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportSnapshot {
    pub text: String,
    pub old_text: String,
    pub document_version: u64,
    pub seq: u64,
    pub anchor: usize,
    pub head: usize,
    pub side: String,
    pub marked: Option<Range<usize>>,
    pub scroll_top: f32,
    pub scroll_left: f32,
    pub bounds: [f32; 4],
    pub paint_count: u64,
    pub painted_document_version: u64,
}
impl gpui::Focusable for Viewport {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Viewport {
    pub fn new(spec: Spec, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_focus(spec, cx.focus_handle(), window, cx)
    }
    fn with_focus(
        spec: Spec,
        focus: FocusHandle,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.on_focus(&focus, window, |view, _, cx| {
            view.emit(json!({"kind":"focus"}), cx);
            cx.notify();
        })
        .detach();
        cx.on_blur(&focus, window, |view, _, cx| {
            view.emit(json!({"kind":"blur"}), cx);
            cx.notify();
        })
        .detach();
        let mut view = Self {
            accessible_value: SharedString::default(),
            spec: Spec::default(),
            focus: focus.clone(),
            children: vec![],
            paint_observer: None,
            paint_count: 0,
            painted_document_version: 0,
            #[cfg(feature = "react")]
            react: react::State::default(),
            seq: 0,
            scroll_top: spec.scroll_top,
            scroll_left: spec.scroll_left,
            bounds: Bounds::default(),
            layouts: HashMap::new(),
            tops: vec![],
            heights: vec![],
            width: 0.,
            total_height: 0.,
            content_width: 0.,
            anchor: 0,
            head: 0,
            side: "additions".into(),
            last_focus_request: 0,
            dragging: false,
            drag_alt: false,
            drag_origin: None,
            drag_gutter: false,
            drag_point: None,
            drag_task: None,
            marked: None,
            composition: None,
            composition_text: None,
            composition_rows: Vec::new(),
            blink: None,
            blink_on: true,
            prediction_shown: false,
            alt_pressed: false,
            reveal_pending: false,
            dirty: true,
            annotation_heights: HashMap::new(),
            hover_hit: None,
            scroll_anchor: None,
        };
        view.apply_spec(spec, window, cx);
        view
    }
    pub fn set_children(&mut self, children: Vec<gpui::AnyView>, cx: &mut Context<Self>) {
        self.children = children;
        cx.notify();
    }
    /// An optional observer receives each text painted by this view, including chrome.
    /// It does not own the editor document and must not re-enter this entity.
    pub fn set_paint_observer(&mut self, observer: Option<Rc<dyn Fn(SharedString)>>) {
        self.paint_observer = observer;
    }
    fn log_painted_text(&self, text: SharedString) {
        if let Some(observer) = &self.paint_observer {
            observer(text);
        }
    }
    pub fn snapshot(&self) -> ViewportSnapshot {
        ViewportSnapshot {
            text: self.text().to_owned(),
            old_text: self.spec.old_text.clone(),
            document_version: self.spec.document_version,
            seq: self.seq,
            anchor: self.anchor,
            head: self.head,
            side: self.side.clone(),
            marked: self.marked.clone(),
            scroll_top: self.scroll_top,
            scroll_left: self.scroll_left,
            bounds: [
                self.bounds.left().into(),
                self.bounds.top().into(),
                self.bounds.size.width.into(),
                self.bounds.size.height.into(),
            ],
            paint_count: self.paint_count,
            painted_document_version: self.painted_document_version,
        }
    }
    pub fn shutdown(&mut self, window: &mut Window) {
        self.blink = None;
        self.drag_task = None;
        self.dragging = false;
        if self.focus.is_focused(window) {
            window.blur();
        }
    }
}
impl gpui::Render for Viewport {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let children = self
            .children
            .iter()
            .cloned()
            .map(IntoElement::into_any_element)
            .collect();
        let content = self.render_view(children, window, cx);
        let root = div()
            .id("pierre-viewport")
            .relative()
            .w_full()
            .h_full()
            .min_w_0()
            .min_h_0()
            .track_focus(&self.focus)
            .role(gpui::Role::MultilineTextInput)
            .aria_value(self.accessible_value.clone())
            .child(content);
        #[cfg(feature = "react")]
        let root = self
            .react
            .style
            .apply_interactive(root)
            .aria_label(self.react.label.clone());
        root
    }
}
struct CompositionPreview {
    range: Range<usize>,
    text: String,
    selected: Range<usize>,
}
impl Viewport {
    // Row backups are valid only for the source rows they came from. Restore
    // them before any source mutation, then rebuild the preview on unchanged text.
    fn take_composition_preview(&mut self) -> Option<CompositionPreview> {
        let composition = self.composition.take();
        let marked = self.marked.take();
        self.composition_text = None;
        self.restore_composition_rows();
        composition.map(|(range, text)| {
            let start = marked.map_or(range.start, |marked| marked.start);
            let selection = self.range();
            CompositionPreview {
                range,
                text,
                selected: selection.start.saturating_sub(start)
                    ..selection.end.saturating_sub(start),
            }
        })
    }
    fn resume_composition_preview(
        &mut self,
        preview: Option<CompositionPreview>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(preview) = preview {
            self.replace_and_mark_text_in_range(
                Some(preview.range),
                &preview.text,
                Some(preview.selected),
                window,
                cx,
            );
        }
    }
    fn restore_composition_rows(&mut self) {
        for (i, row) in self.composition_rows.drain(..) {
            self.spec.rows[i] = row;
            self.layouts.remove(&(i, false));
            self.layouts.remove(&(i, true));
        }
        self.dirty = true;
    }
    fn emit(&mut self, mut value: Value, cx: &mut Context<Self>) {
        self.seq += 1;
        value["seq"] = json!(self.seq);
        value["documentVersion"] = json!(self.spec.document_version);
        cx.emit(ViewportEvent(value));
    }
    fn gutter(&self) -> f32 {
        let numbers = if self.spec.line_numbers {
            self.spec.gutter
        } else {
            0.
        };
        let utility = self.spec.gutter_utility_width;
        if self.spec.indicators == "classic" {
            numbers.max(utility) + 16.
        } else {
            numbers.max(utility).max(if self.spec.indicators == "bars" {
                16.
            } else {
                0.
            })
        }
    }
    fn pane_width(&self) -> f32 {
        if self.spec.split {
            ((self.width - if self.spec.wrap { 1. } else { 2. }) / 2.).max(0.)
        } else {
            self.width
        }
    }
    fn pane_origin(&self, right: bool) -> f32 {
        if right {
            self.pane_width() + if self.spec.wrap { 1. } else { 2. }
        } else {
            0.
        }
    }
    fn cell_width(&self, right: bool) -> f32 {
        self.pane_width()
            - if self.spec.split && self.spec.wrap && !right {
                1.
            } else {
                0.
            }
    }
    fn shape(&self, cell: &Cell, width: f32, window: &mut Window) -> ShapedCell {
        let mut display = String::new();
        let mut map = vec![(0, 0)];
        let mut units = 0;
        let mut column = 0;
        for c in cell.text.chars() {
            let count = if c == '\t' {
                self.spec.tab_size.max(1) - column % self.spec.tab_size.max(1)
            } else {
                1
            };
            if c == '\t' {
                display.extend(std::iter::repeat_n(' ', count));
            } else {
                display.push(c);
            }
            units += c.len_utf16();
            column += count;
            map.push((display.len(), units));
        }
        let mut boundaries = vec![0, units];
        for t in &cell.tokens {
            boundaries.push(t.start.min(units));
            boundaries.push(t.end.min(units));
        }
        boundaries.sort();
        boundaries.dedup();
        let mut runs = vec![];
        for pair in boundaries.windows(2) {
            let start = map
                .iter()
                .find(|(_, u)| *u >= pair[0])
                .map(|(b, _)| *b)
                .unwrap_or(display.len());
            let end = map
                .iter()
                .find(|(_, u)| *u >= pair[1])
                .map(|(b, _)| *b)
                .unwrap_or(display.len());
            if end <= start {
                continue;
            }
            let t = cell
                .tokens
                .iter()
                .rev()
                .find(|t| t.start <= pair[0] && t.end >= pair[1]);
            let mut font = gpui::font(self.spec.font_family.clone());
            if let Some(t) = t {
                if t.italic {
                    font.style = gpui::FontStyle::Italic;
                }
                if t.bold {
                    font.weight = gpui::FontWeight::BOLD;
                }
            }
            runs.push(TextRun {
                len: end - start,
                font,
                color: t
                    .map(|t| color(&t.color))
                    .unwrap_or(color(&self.spec.foreground)),
                background_color: t.and_then(|t| t.background.as_ref().map(|c| color(c))),
                underline: t.filter(|t| t.underline).map(|_| gpui::UnderlineStyle {
                    thickness: px(1.),
                    color: Some(color(&self.spec.foreground)),
                    wavy: false,
                }),
                strikethrough: None,
            });
        }
        // Shape an empty row as an empty string. GPUI still supplies a line box.
        let mut line = window
            .text_system()
            .shape_text(
                SharedString::from(display.clone()),
                px(self.spec.font_size),
                &runs,
                None,
                None,
            )
            .unwrap()
            .into_vec()
            .into_iter()
            .next()
            .unwrap();
        if self.spec.wrap {
            line = wrap_code_line(line, px(width.max(1.)));
        }
        let height =
            f32::from(line.size(px(self.spec.line_height)).height).max(self.spec.line_height);
        let full_width = f32::from(line.unwrapped_layout.width);
        ShapedCell {
            line,
            display,
            map,
            height,
            width: full_width,
            key: serde_json::to_string(&(
                cell.text.as_str(),
                cell.tokens
                    .iter()
                    .map(|t| {
                        (
                            &t.color,
                            &t.background,
                            t.start,
                            t.end,
                            t.italic,
                            t.bold,
                            t.underline,
                        )
                    })
                    .collect::<Vec<_>>(),
            ))
            .unwrap(),
        }
    }
    fn ensure_cell(&mut self, row: usize, right: bool, window: &mut Window) {
        let Some(cell) = self.spec.rows.get(row).and_then(|r| {
            if right {
                r.right.as_ref()
            } else {
                r.left.as_ref()
            }
        }) else {
            // Inserting a slot can replace a cached code row at this index.
            // Its old line box must not add height to the annotation or overlay.
            self.layouts.remove(&(row, right));
            return;
        };
        let key = serde_json::to_string(&(
            cell.text.as_str(),
            cell.tokens
                .iter()
                .map(|t| {
                    (
                        &t.color,
                        &t.background,
                        t.start,
                        t.end,
                        t.italic,
                        t.bold,
                        t.underline,
                    )
                })
                .collect::<Vec<_>>(),
        ))
        .unwrap();
        if self
            .layouts
            .get(&(row, right))
            .is_some_and(|s| s.key == key)
        {
            return;
        }
        let shaped = self.shape(cell, self.cell_width(right) - self.gutter() - 16., window);
        self.content_width = self.content_width.max(shaped.width);
        self.layouts.insert((row, right), shaped);
    }
    fn remember_anchor(&mut self) {
        if self.scroll_top <= 0. || self.scroll_anchor.is_some() || self.tops.is_empty() {
            return;
        }
        let index = self.row_at(self.scroll_top);
        if let Some(row) = self.spec.rows.get(index) {
            self.scroll_anchor = Some((row.id.clone(), index, self.scroll_top - self.tops[index]));
        }
    }
    fn layout(&mut self, width: f32, height: f32, window: &mut Window, cx: &mut Context<Self>) {
        if (self.width - width).abs() > 0.1 {
            self.remember_anchor();
            self.width = width;
            self.layouts.clear();
            self.dirty = true;
        }
        let layout_changed = self.dirty;
        if self.dirty {
            self.tops.clear();
            self.heights.clear();
            self.total_height = 0.;
            let count = self.spec.rows.len();
            self.layouts.retain(|(row, _), _| *row < count);
            for i in 0..count {
                let mut h =
                    self.annotation_heights.get(&i).copied().unwrap_or_else(|| {
                        self.spec.rows[i].height.unwrap_or(self.spec.line_height)
                    });
                if self.spec.wrap {
                    self.ensure_cell(i, false, window);
                    self.ensure_cell(i, true, window);
                    for right in [false, true] {
                        if let Some(s) = self.layouts.get(&(i, right)) {
                            h = h.max(s.height);
                        }
                    }
                }
                for prediction in &self.spec.predictions {
                    let cell = if self.spec.split {
                        self.spec.rows[i].right.as_ref()
                    } else {
                        self.spec.rows[i].left.as_ref()
                    };
                    if cell.is_some_and(|c| {
                        c.side != "deletions"
                            && c.number == Some(prediction.end_line + 1)
                            && (self.spec.active_owner.is_empty()
                                || c.owner == self.spec.active_owner)
                    }) && !prediction.text.is_empty()
                    {
                        let ghost_height: f32 = self
                            .ghost_lines(prediction, window)
                            .iter()
                            .map(|s| s.height)
                            .sum();
                        let source_height: f32 = self
                            .spec
                            .rows
                            .iter()
                            .enumerate()
                            .filter_map(|(r, row)| {
                                let c = if self.spec.split {
                                    row.right.as_ref()
                                } else {
                                    row.left.as_ref()
                                }?;
                                if c.side == "deletions"
                                    || (!self.spec.active_owner.is_empty()
                                        && c.owner != self.spec.active_owner)
                                    || !c.number.is_some_and(|n| {
                                        n >= prediction.line + 1 && n <= prediction.end_line + 1
                                    })
                                {
                                    return None;
                                }
                                Some(
                                    self.layouts
                                        .get(&(r, self.spec.split))
                                        .map(|s| s.height)
                                        .unwrap_or(self.spec.line_height),
                                )
                            })
                            .sum();
                        h += (ghost_height - source_height).max(0.);
                    }
                }
                self.tops.push(self.total_height);
                self.heights.push(h);
                self.total_height += h;
            }
            self.dirty = false;
            if let Some((id, index, offset)) = self.scroll_anchor.take() {
                let index = self
                    .spec
                    .rows
                    .iter()
                    .position(|r| r.id == id)
                    .unwrap_or(index.min(self.spec.rows.len().saturating_sub(1)));
                if let Some(top) = self.tops.get(index) {
                    self.scroll_top = *top + offset.min(self.heights[index].max(1.) - 1.);
                }
            }
        }
        if self.reveal_pending {
            let target = self.head;
            for i in 0..self.spec.rows.len() {
                let found = [
                    self.spec.rows[i].left.as_ref(),
                    self.spec.rows[i].right.as_ref(),
                ]
                .into_iter()
                .flatten()
                .find(|c| {
                    c.side != "deletions"
                        && c.start.is_some_and(|s| {
                            target >= s && target <= s + c.text.encode_utf16().count()
                        })
                });
                if let Some(cell) = found {
                    let offset = target - cell.start.unwrap_or(0);
                    self.ensure_cell(i, self.spec.split, window);
                    let shape = &self.layouts[&(i, self.spec.split)];
                    let point = shape
                        .position_for_index(shape.byte_for_units(offset), px(self.spec.line_height))
                        .unwrap_or_default();
                    let y = self.tops[i] + f32::from(point.y);
                    if y < self.scroll_top {
                        self.scroll_top = y;
                    } else if y + self.spec.line_height > self.scroll_top + height {
                        self.scroll_top = y + self.spec.line_height - height;
                    }
                    if !self.spec.wrap {
                        let x = f32::from(point.x);
                        let available = (self.pane_width() - self.gutter() - 16.).max(1.);
                        if x < self.scroll_left {
                            self.scroll_left = x;
                        } else if x + 2. > self.scroll_left + available {
                            self.scroll_left = x + 2. - available;
                        }
                    }
                    break;
                }
            }
            self.reveal_pending = false;
        }
        self.scroll_top = self
            .scroll_top
            .clamp(0., (self.total_height - height).max(0.));
        let start = self
            .tops
            .partition_point(|y| *y < self.scroll_top)
            .saturating_sub(1);
        for i in start..self.spec.rows.len() {
            if self.tops[i] > self.scroll_top + height {
                break;
            }
            self.ensure_cell(i, false, window);
            self.ensure_cell(i, true, window);
        }
        if self.spec.wrap {
            self.scroll_left = 0.;
        }
        if layout_changed {
            let mut lines = serde_json::Map::new();
            for ((row, right), layout) in &self.layouts {
                let cell = if *right {
                    self.spec.rows[*row].right.as_ref()
                } else {
                    self.spec.rows[*row].left.as_ref()
                };
                if let Some(cell) = cell.filter(|c| {
                    c.side != "deletions"
                        && (self.spec.active_owner.is_empty() || c.owner == self.spec.active_owner)
                }) {
                    if let Some(number) = cell.number {
                        let mut offsets = vec![0];
                        for boundary in &layout.line.wrap_boundaries {
                            let glyph = &layout.line.unwrapped_layout.runs[boundary.run_ix].glyphs
                                [boundary.glyph_ix];
                            offsets.push(layout.units_for_byte(glyph.index));
                        }
                        offsets.push(cell.text.encode_utf16().count());
                        lines.insert((number - 1).to_string(), json!(offsets));
                    }
                }
            }
            self.emit(json!({"kind":"layout","documentVersion":self.spec.document_version,"softLines":lines,"viewportLines":(height/self.spec.line_height).max(1.) as usize}), cx);
        }
        // Bound the shape cache independently of the document length in scroll mode.
        if !self.spec.wrap && self.layouts.len() > 2048 {
            let end = start + ((height / self.spec.line_height) as usize) + 128;
            self.layouts
                .retain(|(r, _), _| *r >= start.saturating_sub(128) && *r <= end);
        }
    }
    fn row_at(&self, y: f32) -> usize {
        self.tops
            .partition_point(|top| *top <= y)
            .saturating_sub(1)
            .min(self.spec.rows.len().saturating_sub(1))
    }
    fn hit(&self, p: Point<Pixels>) -> Option<(usize, bool, usize, bool)> {
        if self.spec.rows.is_empty() {
            return None;
        }
        let x = f32::from(p.x - self.bounds.left());
        let y = f32::from(p.y - self.bounds.top()) + self.scroll_top;
        let row = self.row_at(y);
        let right = self.spec.split && x >= self.pane_origin(true);
        let local = x - self.pane_origin(right);
        let cell = if right {
            self.spec.rows[row].right.as_ref()
        } else {
            self.spec.rows[row].left.as_ref()
        }?;
        let start = cell.start?;
        let shape = self.layouts.get(&(row, right))?;
        let pos = point(
            px((local - self.gutter() - 8. + self.scroll_left).max(0.)),
            px((y - self.tops[row]).max(0.)),
        );
        let byte = shape
            .line
            .closest_index_for_position(pos, px(self.spec.line_height))
            .unwrap_or(shape.display.len());
        Some((
            row,
            right,
            start + shape.units_for_byte(byte),
            local < self.gutter(),
        ))
    }
    fn select_at(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        if !self.spec.read_only {
            window.request_text_input();
        }
        self.blink_on = true;
        let y = f32::from(event.position.y - self.bounds.top()) + self.scroll_top;
        let row = self.row_at(y);
        if let Some(action) = self.spec.rows.get(row).and_then(|r| r.action.clone()) {
            self.emit(json!({"kind":"action","row":row,"action":action}), cx);
            return;
        }
        if let Some((row, right, offset, gutter)) = self.hit(event.position) {
            let cell = if right {
                self.spec.rows[row].right.as_ref()
            } else {
                self.spec.rows[row].left.as_ref()
            }
            .unwrap();
            let side = cell.side.clone();
            if !event.modifiers.shift || side != self.side {
                self.anchor = offset;
            }
            self.head = offset;
            self.side = side;
            if self.side == "deletions" && event.click_count == 2 && !gutter {
                let start = cell.start.unwrap_or(0);
                let local = byte_at(&cell.text, offset.saturating_sub(start));
                if let Some((byte, word)) = cell
                    .text
                    .split_word_bound_indices()
                    .find(|(byte, word)| *byte <= local && local < *byte + word.len())
                {
                    self.anchor = start + units_at(&cell.text, byte);
                    self.head = self.anchor + word.encode_utf16().count();
                }
            }
            if gutter || (self.side == "deletions" && event.click_count >= 3) {
                self.anchor = cell.start.unwrap_or(offset);
                self.head = self.anchor + cell.text.encode_utf16().count();
            }
            self.dragging = true;
            self.drag_alt = event.modifiers.alt;
            self.drag_gutter = gutter;
            self.drag_origin = Some(event.position);
            self.drag_point = Some(event.position);
            self.emit(json!({"kind":"select","anchor":self.anchor,"head":self.head,"side":self.side,"alt":event.modifiers.alt,"addCaret":if cfg!(target_os="macos"){event.modifiers.platform}else{event.modifiers.control},"shift":event.modifiers.shift,"clickCount":event.click_count,"action":if gutter{"line"}else{"text"},"row":row}), cx);
            cx.notify();
        }
    }
    fn drag(&mut self, p: Point<Pixels>, cx: &mut Context<Self>) {
        if !self.dragging {
            return;
        }
        self.drag_point = Some(p);
        let outside = p.y < self.bounds.top() || p.y > self.bounds.bottom();
        if !outside {
            self.drag_task = None;
        } else if self.drag_task.is_none() {
            self.drag_task = Some(cx.spawn(async move |this, cx| loop {
                cx.background_executor()
                    .timer(Duration::from_millis(16))
                    .await;
                let keep = this
                    .update(cx, |s, cx| {
                        if !s.dragging {
                            return false;
                        }
                        let Some(p) = s.drag_point else {
                            return false;
                        };
                        let distance = if p.y < s.bounds.top() {
                            f32::from(p.y - s.bounds.top())
                        } else if p.y > s.bounds.bottom() {
                            f32::from(p.y - s.bounds.bottom())
                        } else {
                            return false;
                        };
                        let delta = distance.signum()
                            * (distance.abs() * 0.2).clamp(1., s.spec.line_height);
                        s.scroll_top = (s.scroll_top + delta).clamp(
                            0.,
                            (s.total_height - f32::from(s.bounds.size.height)).max(0.),
                        );
                        s.drag(p, cx);
                        cx.notify();
                        true
                    })
                    .unwrap_or(false);
                if !keep {
                    break;
                }
            }));
        }
        let p = point(
            p.x,
            p.y.clamp(self.bounds.top(), self.bounds.bottom() - px(0.5)),
        );
        if self.drag_alt {
            if let Some(origin) = self.drag_origin {
                let a = self.row_at(f32::from(origin.y - self.bounds.top()) + self.scroll_top);
                let b = self.row_at(f32::from(p.y - self.bounds.top()) + self.scroll_top);
                if a != b {
                    let mut ranges = vec![];
                    for i in a.min(b)..=a.max(b) {
                        let y = self.bounds.top()
                            + px(self.tops[i] - self.scroll_top + self.spec.line_height / 2.);
                        if let (Some(left), Some(right)) =
                            (self.hit(point(origin.x, y)), self.hit(point(p.x, y)))
                        {
                            ranges.push(vec![left.2, right.2]);
                        }
                    }
                    self.emit(
                        json!({"kind":"select","ranges":ranges,"side":self.side}),
                        cx,
                    );
                    cx.notify();
                    return;
                }
            }
        }
        if let Some((row, right, offset, _)) = self.hit(p) {
            let cell = if right {
                self.spec.rows[row].right.as_ref()
            } else {
                self.spec.rows[row].left.as_ref()
            };
            if let Some(cell) = cell.filter(|c| c.side == self.side || self.drag_gutter) {
                let side = cell.side.clone();
                self.head = if self.drag_gutter {
                    cell.start.unwrap_or(offset) + cell.text.encode_utf16().count()
                } else {
                    offset
                };
                self.emit(json!({"kind":"select","anchor":self.anchor,"head":self.head,"side":side,"row":row,"action":if self.drag_gutter{"line"}else{"drag"},"shift":true}), cx);
                cx.notify();
            }
        }
    }
    fn scroll(&mut self, event: &ScrollWheelEvent, window: &mut Window, cx: &mut Context<Self>) {
        if window.default_prevented() {
            return;
        }
        let previous = (self.scroll_top, self.scroll_left);
        let d = event.delta.pixel_delta(px(self.spec.line_height));
        self.scroll_top = (self.scroll_top - f32::from(d.y)).clamp(
            0.,
            (self.total_height - f32::from(self.bounds.size.height)).max(0.),
        );
        if !self.spec.wrap {
            self.scroll_left = (self.scroll_left - f32::from(d.x)).clamp(
                0.,
                (self.content_width + self.gutter() + 16. - self.pane_width()).max(0.),
            );
        }
        self.reveal_pending = false;
        self.emit(
            json!({"kind":"scroll","scrollTop":self.scroll_top,"scrollLeft":self.scroll_left}),
            cx,
        );
        if previous != (self.scroll_top, self.scroll_left) {
            // GPUI consumes only the default scroll action. Leave observers
            // reachable, and let the next wheel at our boundary scroll a parent.
            window.prevent_default();
            cx.notify();
        }
    }
    fn geometry(&self, offset: usize) -> Option<Point<Pixels>> {
        for (i, row) in self.spec.rows.iter().enumerate() {
            for right in [false, true] {
                let cell = if right {
                    row.right.as_ref()
                } else {
                    row.left.as_ref()
                };
                let Some(c) = cell else {
                    continue;
                };
                if c.side == "deletions" {
                    continue;
                }
                let Some(start) = c.start else {
                    continue;
                };
                if offset < start || offset > start + c.text.encode_utf16().count() {
                    continue;
                }
                let s = self.layouts.get(&(i, right))?;
                let p = s.position_for_index(
                    s.byte_for_units(offset - start),
                    px(self.spec.line_height),
                )?;
                let x = self.bounds.left()
                    + px(self.pane_origin(right))
                    + px(self.gutter() + 8. - self.scroll_left)
                    + p.x;
                let y = self.bounds.top() + px(self.tops[i] - self.scroll_top) + p.y;
                return Some(point(x, y));
            }
        }
        None
    }
    fn range(&self) -> Range<usize> {
        self.anchor.min(self.head)..self.anchor.max(self.head)
    }
    fn text(&self) -> &str {
        if let Some(text) = &self.composition_text {
            return text;
        }
        if self.side == "deletions" {
            &self.spec.old_text
        } else {
            &self.spec.text
        }
    }
}
impl Viewport {
    fn render_view(
        &mut self,
        children: Vec<gpui::AnyElement>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        if !self.focus.is_focused(window) || !window.is_window_active() || self.spec.read_only {
            self.blink = None;
        } else if self.blink.is_none() {
            self.blink = Some(cx.spawn(async move |this, cx| loop {
                cx.background_executor()
                    .timer(Duration::from_millis(530))
                    .await;
                if this
                    .update(cx, |s, cx| {
                        s.blink_on = !s.blink_on;
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }));
        }
        let capture = cx.entity();
        div().w_full().h_full().min_h_0().min_w_0().track_focus(&self.focus).cursor(CursorStyle::IBeam)
   .capture_key_down(move|event,window,cx|{let key=&event.keystroke.key;let m=event.keystroke.modifiers;let special=m.platform||m.control||matches!(key.as_str(),"left"|"right"|"up"|"down"|"home"|"end"|"pageup"|"pagedown"|"backspace"|"delete"|"enter"|"tab"|"escape"|"alt");if special&&capture.read(cx).marked.is_none(){capture.update(cx,|s,cx|{if s.side=="deletions"&&m.platform&&key=="c"{let r=s.range();let text=s.text();cx.write_to_clipboard(ClipboardItem::new_string(text[byte_at(text,r.start)..byte_at(text,r.end)].to_string()));}else if s.side!="deletions"{s.blink_on=true;s.emit(json!({"kind":"key","key":key,"meta":m.platform,"ctrl":m.control,"alt":m.alt,"shift":m.shift}), cx);}cx.notify();});window.prevent_default();cx.stop_propagation();}})
   .on_modifiers_changed(cx.listener(|s,event:&gpui::ModifiersChangedEvent,window,cx|{if s.focus.is_focused(window)&&event.modifiers.alt&&!s.alt_pressed{s.emit(json!({"kind":"key","key":"alt","alt":true}), cx);}s.alt_pressed=event.modifiers.alt;cx.notify();}))
   .on_mouse_down(MouseButton::Left,cx.listener(Self::select_at))
   .on_mouse_up(MouseButton::Left,cx.listener(|s,_:&MouseUpEvent,_,_|{s.dragging=false;s.drag_task=None;}))
   .on_mouse_up_out(MouseButton::Left,cx.listener(|s,_:&MouseUpEvent,_,_|{s.dragging=false;s.drag_task=None;}))
   .on_scroll_wheel(cx.listener(Self::scroll))
   .child(Canvas{state:cx.entity(),children,visible_children:vec![]}).into_any_element()
    }
}
impl EntityInputHandler for Viewport {
    fn text_for_range(
        &mut self,
        r: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let text = self.text();
        let a = byte_at(text, r.start);
        let b = byte_at(text, r.end);
        *actual = Some(units_at(text, a)..units_at(text, b));
        Some(text[a..b].to_string())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range(),
            reversed: self.head < self.anchor,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.clone()
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((range, text)) = self.composition.take() {
            self.restore_composition_rows();
            self.marked = None;
            self.composition_text = None;
            self.emit(
                json!({"kind":"select","anchor":range.start,"head":range.end}),
                cx,
            );
            self.emit(json!({"kind":"insert","text":text}), cx);
        }
        cx.notify();
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.spec.read_only || self.side == "deletions" {
            return;
        }
        let range = self.composition.take().map(|(r, _)| r).or(range);
        self.restore_composition_rows();
        self.marked = None;
        self.composition_text = None;
        if let Some(r) = range {
            self.anchor = r.start;
            self.head = r.end;
            self.emit(
                json!({"kind":"select","anchor":self.anchor,"head":self.head}),
                cx,
            );
        }
        self.emit(json!({"kind":"insert","text":text}), cx);
        self.blink_on = true;
        cx.notify();
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.spec.read_only || self.side == "deletions" {
            return;
        }
        let original = self
            .composition
            .as_ref()
            .map(|(r, _)| r.clone())
            .or(range)
            .unwrap_or_else(|| self.range());
        self.restore_composition_rows();
        let source = &self.spec.text;
        let a = byte_at(source, original.start);
        let b = byte_at(source, original.end);
        self.composition_text = Some(source[..a].to_string() + text + &source[b..]);
        self.composition = Some((original.clone(), text.to_string()));
        self.marked = Some(original.start..original.start + text.encode_utf16().count());
        let selected =
            selected.unwrap_or_else(|| text.encode_utf16().count()..text.encode_utf16().count());
        self.anchor = original.start + selected.start;
        self.head = original.start + selected.end;
        for (i, row) in self.spec.rows.iter_mut().enumerate() {
            let backup = row.clone();
            for cell in [&mut row.left, &mut row.right].into_iter().flatten() {
                if cell.side == "deletions" {
                    continue;
                }
                let Some(start) = cell.start else {
                    continue;
                };
                let len = cell.text.encode_utf16().count();
                if original.start >= start && original.start <= start + len {
                    self.composition_rows.push((i, backup));
                    let a = byte_at(&cell.text, original.start - start);
                    let b = byte_at(&cell.text, original.end.saturating_sub(start).min(len));
                    cell.text = cell.text[..a].to_string() + text + &cell.text[b..];
                    cell.tokens = vec![
                        Token {
                            start: 0,
                            end: cell.text.encode_utf16().count(),
                            color: self.spec.foreground.clone(),
                            ..Token::default()
                        },
                        Token {
                            start: original.start - start,
                            end: original.start - start + text.encode_utf16().count(),
                            color: self.spec.foreground.clone(),
                            underline: true,
                            ..Token::default()
                        },
                    ];
                    self.layouts.remove(&(i, self.spec.split));
                    break;
                }
            }
        }
        self.dirty = true;
        self.blink_on = true;
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        r: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        self.geometry(r.start)
            .map(|p| Bounds::new(p, size(px(2.), px(self.spec.line_height))))
    }
    fn character_index_for_point(
        &mut self,
        p: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        self.hit(p).map(|h| h.2)
    }
    fn set_selected_text_range(&mut self, r: Range<usize>, _: &mut Window, cx: &mut Context<Self>) {
        self.anchor = r.start;
        self.head = r.end;
        self.emit(json!({"kind":"select","anchor":r.start,"head":r.end}), cx);
        cx.notify();
    }
    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.text().encode_utf16().count())
    }
    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        !self.spec.read_only && self.side != "deletions"
    }
}
struct Canvas {
    state: Entity<Viewport>,
    children: Vec<gpui::AnyElement>,
    visible_children: Vec<usize>,
}
impl IntoElement for Canvas {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl gpui::Element for Canvas {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<gpui::ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        (window.request_layout(style, [], cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let (split, gutter, slots) = self
            .state
            .read(cx)
            .spec
            .rows
            .iter()
            .enumerate()
            .filter_map(|(i, r)| {
                r.slot.map(|slot| {
                    (
                        i,
                        slot,
                        r.slot_side.clone(),
                        r.overlay,
                        r.slot_inset,
                        r.slot_anchor.clone(),
                        r.slot_width,
                        r.slot_offset,
                    )
                })
            })
            .fold(
                (
                    self.state.read(cx).spec.split,
                    self.state.read(cx).gutter(),
                    Vec::new(),
                ),
                |(a, b, mut all), v| {
                    all.push(v);
                    (a, b, all)
                },
            );
        let width = f32::from(bounds.size.width);
        let wrap = self.state.read(cx).spec.wrap;
        let pane = if split {
            ((width - if wrap { 1. } else { 2. }) / 2.).max(0.)
        } else {
            width
        };
        let mut measured = HashMap::new();
        let mut slot_sizes = HashMap::new();
        for (row, slot, side, overlay, _, _, slot_width, slot_offset) in &slots {
            if let Some(child) = self.children.get_mut(*slot) {
                let sz = child.layout_as_root(
                    size(
                        gpui::AvailableSpace::Definite(px(slot_width
                            .unwrap_or(if side == "full" {
                                width
                            } else {
                                pane - gutter - if slot_offset.is_some() { 16. } else { 0. }
                            })
                            .min(if slot_offset.is_some() {
                                (pane - gutter - 16.).max(1.)
                            } else {
                                f32::MAX
                            })
                            .max(1.))),
                        gpui::AvailableSpace::MinContent,
                    ),
                    window,
                    cx,
                );
                slot_sizes.insert(*row, sz);
                measured.insert(*row, if *overlay { 0. } else { f32::from(sz.height) });
            }
        }
        self.state.update(cx, |s, cx| {
            if measured != s.annotation_heights {
                s.remember_anchor();
                s.annotation_heights = measured;
                s.dirty = true;
            }
            s.bounds = bounds;
            s.layout(width, f32::from(bounds.size.height), window, cx);
        });
        self.visible_children.clear();
        for (row, slot, side, _overlay, inset, anchor, _, offset) in slots {
            let state = self.state.read(cx);
            let anchor_row = anchor
                .as_ref()
                .and_then(|id| state.spec.rows.iter().position(|r| &r.id == id))
                .unwrap_or(row);
            let mut y = state.tops.get(anchor_row).copied().unwrap_or(0.) - state.scroll_top;
            if state.spec.rows[row].sticky && y < 0. {
                let next = state
                    .spec
                    .rows
                    .iter()
                    .enumerate()
                    .skip(row + 1)
                    .find(|(_, r)| r.sticky)
                    .map(|(i, _)| state.tops[i] - state.scroll_top)
                    .unwrap_or(f32::MAX);
                y = 0f32.min(next - state.heights[row]);
            }
            let h = state.heights.get(row).copied().unwrap_or(0.);
            if y + h < 0. || y > f32::from(bounds.size.height) {
                continue;
            }
            let x = if split && side == "additions" {
                pane + if wrap { 1. } else { 2. }
            } else {
                0.
            };
            let mut at = point(
                bounds.left() + px(x + inset.unwrap_or(gutter)),
                bounds.top() + px(y),
            );
            if let Some(offset) = offset {
                if let (Some(origin), Some(sz)) = (state.geometry(offset), slot_sizes.get(&row)) {
                    let min_x = bounds.left() + px(x + gutter + 8.);
                    let max_x = (bounds.left() + px(x + pane - 8.) - sz.width).max(min_x);
                    at.x = origin.x.max(min_x).min(max_x);
                    let below = origin.y + px(state.spec.line_height);
                    at.y = if below + sz.height <= bounds.bottom() - px(8.) {
                        below
                    } else {
                        origin.y - sz.height
                    };
                    at.y =
                        at.y.max(bounds.top())
                            .min((bounds.bottom() - sz.height - px(8.)).max(bounds.top()));
                }
            }
            if let Some(child) = self.children.get_mut(slot) {
                window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                    child.prepaint_at(at, window, cx);
                });
                self.visible_children.push(slot);
            }
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.state.read(cx).focus.clone();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.state.clone()),
            cx,
        );
        let state = self.state.clone();
        window.on_mouse_event(move |e: &MouseMoveEvent, phase, _, cx| {
            if phase == DispatchPhase::Bubble {
                state.update(cx, |s, cx| {
                    if e.pressed_button == Some(MouseButton::Left) {
                        s.drag(e.position, cx);
                    } else if !s.bounds.contains(&e.position) {
                        if s.hover_hit.take().is_some() {
                            s.emit(json!({"kind":"hover"}), cx);
                            cx.notify();
                        }
                    } else if let Some((row, right, offset, _)) = s.hit(e.position) {
                        if s.hover_hit != Some((row, right, offset)) {
                            s.hover_hit = Some((row, right, offset));
                            let side = if right || !s.spec.split {
                                "additions"
                            } else {
                                "deletions"
                            };
                            s.emit(
                                json!({"kind":"hover","row":row,"head":offset,"side":side}),
                                cx,
                            );
                            cx.notify();
                        }
                    }
                });
            }
        });
        self.state.update(cx, |s, cx| {
            window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                s.paint(window, cx)
            })
        });
        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            for i in &self.visible_children {
                self.children[*i].paint(window, cx);
            }
        });
    }
}
impl Viewport {
    fn ghost_lines(&self, prediction: &Prediction, window: &mut Window) -> Vec<ShapedCell> {
        if prediction.text.is_empty() {
            return vec![];
        }
        let mut consumed = 0;
        prediction
            .text
            .split('\n')
            .enumerate()
            .map(|(i, text)| {
                let prefix = if i == 0 {
                    prediction.prefix.as_str()
                } else {
                    ""
                };
                let text = text.trim_end_matches('\r');
                let prefix_len = prefix.encode_utf16().count();
                let len = text.encode_utf16().count();
                let ghost = (prediction.ghost_length.saturating_sub(consumed)).min(len);
                consumed += len + 1;
                let cell = Cell {
                    text: format!("{}{}", prefix, text),
                    tokens: vec![
                        Token {
                            start: 0,
                            end: prefix_len,
                            color: self.spec.foreground.clone(),
                            ..Token::default()
                        },
                        Token {
                            start: prefix_len,
                            end: prefix_len + ghost,
                            color: self.spec.number_color.clone(),
                            ..Token::default()
                        },
                        Token {
                            start: prefix_len + ghost,
                            end: prefix_len + len,
                            color: self.spec.foreground.clone(),
                            ..Token::default()
                        },
                    ],
                    ..Cell::default()
                };
                self.shape(&cell, self.pane_width() - self.gutter() - 16., window)
            })
            .collect()
    }
    fn paint_predictions(&self, window: &mut Window, cx: &mut App) {
        for prediction in &self.spec.predictions {
            let Some(anchor) = self.geometry(prediction.anchor) else {
                continue;
            };
            if prediction.text.is_empty() {
                continue;
            }
            let pane_left = self.bounds.left()
                + px(if self.spec.split {
                    self.pane_origin(true)
                } else {
                    0.
                });
            let left = pane_left + px(self.gutter() + 8. - self.scroll_left);
            let right = pane_left + px(self.pane_width());
            let mut top = anchor.y;
            for (index, shape) in self.ghost_lines(prediction, window).iter().enumerate() {
                let prefix_y = if index == 0 {
                    shape
                        .position_for_index(
                            shape.byte_for_units(prediction.prefix.encode_utf16().count()),
                            px(self.spec.line_height),
                        )
                        .map(|p| f32::from(p.y))
                        .unwrap_or(0.)
                } else {
                    0.
                };
                let origin = point(left, top - px(prefix_y));
                let mut y = prefix_y;
                while y < shape.height {
                    let clip_left = if index == 0 && y == prefix_y {
                        anchor.x
                    } else {
                        pane_left + px(self.gutter())
                    };
                    let clip = Bounds::new(
                        point(clip_left, origin.y + px(y)),
                        size((right - clip_left).max(px(0.)), px(self.spec.line_height)),
                    )
                    .intersect(&self.bounds);
                    window.with_content_mask(Some(gpui::ContentMask { bounds: clip }), |window| {
                        window.paint_quad(fill(clip, color(&self.spec.background)));
                        shape
                            .line
                            .paint(
                                origin,
                                px(self.spec.line_height),
                                gpui::TextAlign::Left,
                                None,
                                window,
                                cx,
                            )
                            .ok();
                    });
                    y += self.spec.line_height;
                }
                self.log_painted_text(shape.display.clone().into());
                top += px(shape.height - prefix_y);
            }
        }
    }
    fn chrome(
        &self,
        text: &str,
        origin: Point<Pixels>,
        foreground: &str,
        window: &mut Window,
        cx: &mut App,
    ) {
        if text.is_empty() {
            return;
        }
        let run = TextRun {
            len: text.len(),
            font: gpui::font(self.spec.font_family.clone()),
            color: color(foreground),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let line = window.text_system().shape_line(
            SharedString::from(text.to_string()),
            px(self.spec.font_size),
            &[run],
            None,
        );
        line.paint(
            origin,
            px(self.spec.line_height),
            gpui::TextAlign::Left,
            None,
            window,
            cx,
        )
        .ok();
        self.log_painted_text(text.to_string().into());
    }
    fn paint(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.paint_count += 1;
        self.painted_document_version = self.spec.document_version;
        #[cfg(feature = "react")]
        {
            self.react.frame = gpui_react::current_frame(window, cx);
        }
        let bounds = self.bounds;
        window.paint_quad(fill(bounds, color(&self.spec.background)));
        let first = self
            .tops
            .partition_point(|y| *y < self.scroll_top)
            .saturating_sub(1);
        let mut caret_labels = Vec::new();
        for i in first..self.spec.rows.len() {
            let y = self.tops[i] - self.scroll_top;
            if y > f32::from(bounds.size.height) {
                break;
            }
            let row = &self.spec.rows[i];
            let h = self.heights[i];
            let row_bounds = Bounds::new(
                point(bounds.left(), bounds.top() + px(y)),
                size(bounds.size.width, px(h)),
            );
            if row.slot.is_some() {
                if row.kind == "annotation" && !row.overlay {
                    let width = f32::from(bounds.size.width);
                    let panes = if self.spec.split { 2 } else { 1 };
                    let pane = if self.spec.split {
                        (width - if self.spec.wrap { 1. } else { 2. }) / 2.
                    } else {
                        width
                    };
                    for side in 0..panes {
                        window.paint_quad(fill(
                            Bounds::new(
                                point(
                                    bounds.left()
                                        + px(side as f32 * (width - pane) + self.gutter()),
                                    row_bounds.top(),
                                ),
                                size(px((pane - self.gutter()).max(0.)), row_bounds.size.height),
                            ),
                            color(&self.spec.annotation_background),
                        ));
                    }
                }
                continue;
            }
            if let Some(label) = &row.label {
                let line_info = row.separator_style == "line-info";
                let inset = if line_info { 8. } else { 0. };
                let separator_bounds = Bounds::new(
                    point(
                        row_bounds.left() + px(inset),
                        row_bounds.top() + px(row.margin_top),
                    ),
                    size(
                        (row_bounds.size.width - px(2. * inset)).max(px(0.)),
                        px(if line_info { 32. } else { h }),
                    ),
                );
                window.paint_quad(fill(separator_bounds, color(&self.spec.separator_color)));
                if row.action.is_some() && (line_info || row.separator_style == "line-info-basic") {
                    self.chrome(
                        "↕",
                        point(
                            separator_bounds.left() + px(9.),
                            separator_bounds.top() + px(6.),
                        ),
                        &self.spec.separator_foreground,
                        window,
                        cx,
                    );
                    window.paint_quad(fill(
                        Bounds::new(
                            point(separator_bounds.left() + px(31.), separator_bounds.top()),
                            size(px(2.), separator_bounds.size.height),
                        ),
                        color(&self.spec.background),
                    ));
                }
                self.chrome(
                    label,
                    point(
                        bounds.left() + px(self.gutter() + 8.),
                        separator_bounds.top()
                            + px(
                                (f32::from(separator_bounds.size.height) - self.spec.line_height)
                                    / 2.,
                            ),
                    ),
                    &self.spec.separator_foreground,
                    window,
                    cx,
                );
                continue;
            }
            for right in [false, true] {
                if right && !self.spec.split {
                    continue;
                }
                let x = self.pane_origin(right);
                let pane = self.cell_width(right);
                let cell = if right {
                    row.right.as_ref()
                } else {
                    row.left.as_ref()
                };
                let cb = Bounds::new(
                    point(bounds.left() + px(x), bounds.top() + px(y)),
                    size(px(pane), px(h)),
                );
                let Some(cell) = cell else {
                    window.with_content_mask(
                        Some(gpui::ContentMask {
                            bounds: Bounds::new(
                                point(cb.left() + px(self.gutter()), cb.top()),
                                size(px((pane - self.gutter()).max(0.)), px(h)),
                            )
                            .intersect(&bounds),
                        }),
                        |window| {
                            let mut x = -h - (self.tops[i] % 8.);
                            while x < pane {
                                let mut path = gpui::PathBuilder::stroke(px(1.));
                                path.move_to(point(cb.left() + px(x), cb.bottom()));
                                path.line_to(point(cb.left() + px(x + h), cb.top()));
                                if let Ok(path) = path.build() {
                                    window.paint_path(path, color(&self.spec.buffer));
                                }
                                x += 8.;
                            }
                        },
                    );
                    continue;
                };
                let gutter = self.gutter();
                if let Some(bg) = &cell.background {
                    window.paint_quad(fill(cb, color(bg)));
                }
                if let Some(bg) = &cell.gutter_background {
                    window.paint_quad(fill(
                        Bounds::new(cb.origin, size(px(gutter), px(h))),
                        color(bg),
                    ));
                }
                if self
                    .hover_hit
                    .is_some_and(|(row, side, _)| row == i && side == right)
                {
                    if let Some(colors) = self.spec.hover_colors.get(&cell.kind) {
                        if matches!(self.spec.line_hover_highlight.as_str(), "line" | "both") {
                            if let Some(c) = colors.first() {
                                window.paint_quad(fill(
                                    Bounds::new(
                                        point(cb.left() + px(gutter), cb.top()),
                                        size(px((pane - gutter).max(0.)), px(h)),
                                    ),
                                    color(c),
                                ));
                            }
                        }
                        if matches!(self.spec.line_hover_highlight.as_str(), "number" | "both") {
                            if let Some(c) = colors.get(1) {
                                window.paint_quad(fill(
                                    Bounds::new(cb.origin, size(px(gutter), px(h))),
                                    color(c),
                                ));
                            }
                        }
                    }
                }
                if gutter > 0. {
                    window.paint_quad(fill(
                        Bounds::new(
                            point(cb.left() + px(gutter - 2.), cb.top()),
                            size(px(2.), px(h)),
                        ),
                        color(&self.spec.background),
                    ));
                }
                if cell.kind == "addition" || cell.kind == "deletion" {
                    let accent = if cell.kind == "addition" {
                        &self.spec.addition
                    } else {
                        &self.spec.deletion
                    };
                    if self.spec.indicators == "bars" {
                        if cell.kind == "deletion" {
                            let mut y = 0.;
                            while y < h {
                                window.paint_quad(fill(
                                    Bounds::new(
                                        cb.origin + point(px(0.), px(y)),
                                        size(px(4.), px(1.)),
                                    ),
                                    color(accent),
                                ));
                                y += 2.;
                            }
                        } else {
                            window.paint_quad(fill(
                                Bounds::new(cb.origin, size(px(4.), px(h))),
                                color(accent),
                            ));
                        }
                    } else if self.spec.indicators == "classic" {
                        self.chrome(
                            if cell.kind == "addition" { "+" } else { "−" },
                            point(cb.left() + px(gutter - 12.), cb.top()),
                            accent,
                            window,
                            cx,
                        );
                    }
                }
                if self.spec.line_numbers {
                    if let Some(n) = cell.number {
                        let num = n.to_string();
                        let indicator_width = if self.spec.indicators == "classic" {
                            16.
                        } else {
                            0.
                        };
                        let nx = gutter
                            - indicator_width
                            - 8.
                            - num.len() as f32 * self.spec.font_size * 0.6;
                        self.chrome(
                            &num,
                            point(cb.left() + px(nx), cb.top()),
                            cell.number_color
                                .as_deref()
                                .unwrap_or(&self.spec.number_color),
                            window,
                            cx,
                        );
                    }
                }
                let Some(shape) = self.layouts.get(&(i, right)) else {
                    continue;
                };
                let origin = point(cb.left() + px(gutter + 8. - self.scroll_left), cb.top());
                let text_bounds = Bounds::new(
                    point(cb.left() + px(gutter), cb.top()),
                    size(px((pane - gutter).max(0.)), px(h)),
                );
                window.with_content_mask(
                    Some(gpui::ContentMask {
                        bounds: text_bounds.intersect(&bounds),
                    }),
                    |window| {
                        if let Some(start) = cell.start {
                            let end = start + cell.text.encode_utf16().count();
                            let active = cell.side != "deletions"
                                && self
                                    .spec
                                    .selections
                                    .last()
                                    .is_some_and(|v| v.head >= start && v.head <= end);
                            if active
                                && !self.spec.read_only
                                && self.side != "deletions"
                                && self.focus.is_focused(window)
                            {
                                window.paint_quad(fill(text_bounds, color(&self.spec.active_line)));
                            }
                            for sel in self
                                .spec
                                .decorations
                                .iter()
                                .chain(self.spec.selections.iter())
                            {
                                if (sel.side == "deletions") != (cell.side == "deletions") {
                                    continue;
                                }
                                let a = sel.anchor.min(sel.head);
                                let b = sel.anchor.max(sel.head);
                                if b < start || a > end {
                                    continue;
                                }
                                let from = a.max(start) - start;
                                let to = b.min(end) - start;
                                let p = shape
                                    .position_for_index(
                                        shape.byte_for_units(from),
                                        px(self.spec.line_height),
                                    )
                                    .unwrap_or_default();
                                let q = shape
                                    .position_for_index(
                                        shape.byte_for_units(to),
                                        px(self.spec.line_height),
                                    )
                                    .unwrap_or(p);
                                if a == b {
                                    if (self.spec.read_only || self.side == "deletions")
                                        && sel.color.is_none()
                                    {
                                        continue;
                                    }
                                    if self.focus.is_focused(window) && self.blink_on
                                        || sel.color.is_some()
                                    {
                                        window.paint_quad(fill(
                                            Bounds::new(
                                                origin + p,
                                                size(px(1.5), px(self.spec.line_height)),
                                            ),
                                            color(
                                                sel.color
                                                    .as_deref()
                                                    .unwrap_or(&self.spec.caret_color),
                                            ),
                                        ));
                                    }
                                    if let Some(label) = &sel.label {
                                        caret_labels.push((
                                            origin + p,
                                            label.clone(),
                                            sel.color
                                                .clone()
                                                .unwrap_or_else(|| self.spec.caret_color.clone()),
                                            Bounds::new(
                                                point(cb.left() + px(gutter), bounds.top()),
                                                size(
                                                    px((pane - gutter).max(0.)),
                                                    bounds.size.height,
                                                ),
                                            ),
                                        ));
                                    }
                                    continue;
                                }
                                if sel.kind == "marker" {
                                    let foreground =
                                        color(sel.color.as_deref().unwrap_or(&self.spec.deletion));
                                    let mut y = f32::from(p.y);
                                    while y <= f32::from(q.y) {
                                        let left = if y == f32::from(p.y) {
                                            f32::from(p.x)
                                        } else {
                                            0.
                                        };
                                        let right = if y == f32::from(q.y) {
                                            f32::from(q.x)
                                        } else {
                                            pane - gutter
                                        };
                                        let mut path = gpui::PathBuilder::stroke(px(1.));
                                        let mut x = left;
                                        path.move_to(
                                            origin
                                                + point(px(x), px(y + self.spec.line_height - 0.5)),
                                        );
                                        while x < right {
                                            x = (x + 2.).min(right);
                                            path.line_to(
                                                origin
                                                    + point(
                                                        px(x),
                                                        px(y + self.spec.line_height - 2.),
                                                    ),
                                            );
                                            x = (x + 1.).min(right);
                                            path.line_to(
                                                origin
                                                    + point(
                                                        px(x),
                                                        px(y + self.spec.line_height - 2.),
                                                    ),
                                            );
                                            x = (x + 2.).min(right);
                                            path.line_to(
                                                origin
                                                    + point(
                                                        px(x),
                                                        px(y + self.spec.line_height - 0.5),
                                                    ),
                                            );
                                            x = (x + 1.).min(right);
                                            path.line_to(
                                                origin
                                                    + point(
                                                        px(x),
                                                        px(y + self.spec.line_height - 0.5),
                                                    ),
                                            );
                                        }
                                        if let Ok(path) = path.build() {
                                            window.paint_path(path, foreground);
                                        }
                                        y += self.spec.line_height;
                                    }
                                    continue;
                                }
                                let tint = color(
                                    sel.color.as_deref().unwrap_or(&self.spec.selection_color),
                                );
                                let mut sy = f32::from(p.y);
                                while sy <= f32::from(q.y) {
                                    let lx = if sy == f32::from(p.y) { p.x } else { px(0.) };
                                    let rx = if sy == f32::from(q.y) {
                                        q.x
                                    } else {
                                        px(pane - gutter)
                                    };
                                    window.paint_quad(fill(
                                        Bounds::new(
                                            origin + point(lx, px(sy)),
                                            size((rx - lx).max(px(0.)), px(self.spec.line_height)),
                                        ),
                                        tint,
                                    ));
                                    sy += self.spec.line_height;
                                }
                            }
                            if self.side == "deletions" && self.anchor != self.head {
                                let a = self.anchor.min(self.head).max(start);
                                let b = self.anchor.max(self.head).min(end);
                                if a < b {
                                    let p = shape
                                        .position_for_index(
                                            shape.byte_for_units(a - start),
                                            px(self.spec.line_height),
                                        )
                                        .unwrap_or_default();
                                    let q = shape
                                        .position_for_index(
                                            shape.byte_for_units(b - start),
                                            px(self.spec.line_height),
                                        )
                                        .unwrap_or(p);
                                    let mut y = p.y;
                                    while y <= q.y {
                                        let left = if y == p.y { p.x } else { px(0.) };
                                        let right = if y == q.y { q.x } else { px(pane - gutter) };
                                        window.paint_quad(fill(
                                            Bounds::new(
                                                origin + point(left, y),
                                                size(
                                                    (right - left).max(px(0.)),
                                                    px(self.spec.line_height),
                                                ),
                                            ),
                                            color(&self.spec.selection_color),
                                        ));
                                        y += px(self.spec.line_height);
                                    }
                                }
                            }
                        }
                        shape
                            .line
                            .paint_background(
                                origin,
                                px(self.spec.line_height),
                                gpui::TextAlign::Left,
                                None,
                                window,
                                cx,
                            )
                            .ok();
                        shape
                            .line
                            .paint(
                                origin,
                                px(self.spec.line_height),
                                gpui::TextAlign::Left,
                                None,
                                window,
                                cx,
                            )
                            .ok();
                        self.log_painted_text(cell.text.clone().into());
                    },
                );
            }
        }
        // Cursor badges extend into the preceding row. Paint them after all rows,
        // clipped to the pane and viewport instead of the caret's own text row.
        for (caret, label, tint, clip) in caret_labels {
            let run = TextRun {
                len: label.len(),
                font: gpui::font(".SystemUIFont"),
                color: color("#ffffff"),
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            let line = window.text_system().shape_line(
                SharedString::from(label.clone()),
                px(11.),
                &[run],
                None,
            );
            let width = line.width + px(10.);
            let origin = point(
                caret.x.min(clip.right() - width).max(clip.left()),
                (caret.y - px(18.)).max(clip.top()),
            );
            window.with_content_mask(
                Some(gpui::ContentMask {
                    bounds: clip.intersect(&bounds),
                }),
                |window| {
                    window.paint_quad(gpui::quad(
                        Bounds::new(origin, size(width, px(18.))),
                        px(4.),
                        color(&tint),
                        px(0.),
                        color(&tint),
                        gpui::BorderStyle::Solid,
                    ));
                    line.paint(
                        origin + point(px(5.), px(1.)),
                        px(16.),
                        gpui::TextAlign::Left,
                        None,
                        window,
                        cx,
                    )
                    .ok();
                    self.log_painted_text(label.into());
                },
            );
        }
        let visible = !self.spec.predictions.is_empty()
            && self.spec.predictions.iter().all(|p| {
                let Some(a) = self.geometry(p.anchor) else {
                    return false;
                };
                let Some(b) = self.geometry(p.head) else {
                    return false;
                };
                let preview_height: f32 = self
                    .ghost_lines(p, window)
                    .iter()
                    .map(|line| line.height)
                    .sum();
                a.y >= bounds.top()
                    && b.y + px(self.spec.line_height) <= bounds.bottom()
                    && a.y + px(preview_height) <= bounds.bottom()
            });
        if self.prediction_shown != visible {
            self.prediction_shown = visible;
            self.emit(json!({"kind":"layout","predictionRendered":visible}), cx);
        }
        if visible {
            self.paint_predictions(window, cx);
        }
        if self.marked.is_some() && !self.spec.read_only && self.side != "deletions" {
            if let Some(p) = self.geometry(self.head) {
                window.paint_quad(fill(
                    Bounds::new(p, size(px(1.5), px(self.spec.line_height))),
                    color(&self.spec.caret_color),
                ));
            }
        }

        if self.total_height > f32::from(bounds.size.height) {
            let height = f32::from(bounds.size.height);
            let thumb = (height * height / self.total_height).max(24.);
            let top = self.scroll_top / (self.total_height - height) * (height - thumb);
            window.paint_quad(fill(
                Bounds::new(
                    point(bounds.right() - px(5.), bounds.top() + px(top)),
                    size(px(3.), px(thumb)),
                ),
                color(&self.spec.number_color),
            ));
        }
    }
}
#[cfg(test)]
mod tests;
