//! Pierre document and presentation payloads, shared by both adapters.
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Token {
    pub start: usize,
    pub end: usize,
    pub color: String,
    pub background: Option<String>,
    pub italic: bool,
    pub bold: bool,
    pub underline: bool,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cell {
    pub owner: String,
    pub text: String,
    pub number: Option<usize>,
    pub other_number: Option<usize>,
    pub start: Option<usize>,
    pub side: String,
    pub kind: String,
    pub tokens: Vec<Token>,
    pub background: Option<String>,
    pub gutter_background: Option<String>,
    pub number_color: Option<String>,
    pub no_eol: bool,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Row {
    pub sticky: bool,
    pub separator_style: String,
    pub margin_top: f32,
    pub id: String,
    pub left: Option<Cell>,
    pub right: Option<Cell>,
    pub label: Option<String>,
    pub height: Option<f32>,
    pub action: Option<String>,
    pub kind: String,
    pub slot: Option<usize>,
    pub slot_side: String,
    pub slot_inset: Option<f32>,
    pub slot_anchor: Option<String>,
    pub slot_width: Option<f32>,
    pub slot_offset: Option<usize>,
    pub overlay: bool,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
    pub color: Option<String>,
    pub label: Option<String>,
    pub side: String,
    pub kind: String,
}
#[derive(Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prediction {
    pub anchor: usize,
    pub head: usize,
    pub prefix: String,
    pub text: String,
    pub ghost_length: usize,
    pub line: usize,
    pub end_line: usize,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Spec {
    pub text: String,
    pub old_text: String,
    pub rows: Vec<Row>,
    pub selections: Vec<Selection>,
    pub decorations: Vec<Selection>,
    pub predictions: Vec<Prediction>,
    pub split: bool,
    pub wrap: bool,
    pub read_only: bool,
    pub line_numbers: bool,
    pub line_hover_highlight: String,
    pub hover_colors: HashMap<String, Vec<String>>,
    pub indicators: String,
    pub font_family: String,
    pub font_size: f32,
    pub line_height: f32,
    pub tab_size: usize,
    pub gutter: f32,
    pub gutter_utility_width: f32,
    pub foreground: String,
    pub background: String,
    pub number_color: String,
    pub selection_color: String,
    pub caret_color: String,
    pub separator_color: String,
    pub annotation_background: String,
    pub separator_foreground: String,
    pub addition: String,
    pub deletion: String,
    pub buffer: String,
    pub active_line: String,
    pub active_owner: String,
    pub focus_request: u64,
    pub session: u64,
    pub reset_session_scroll: bool,
    pub document_version: u64,
    pub revision: u64,
    pub ack: u64,
    pub reveal: u64,
    pub scroll_request: u64,
    pub scroll_top: f32,
    pub scroll_left: f32,
}
impl Default for Spec {
    fn default() -> Self {
        Self {
            text: String::new(),
            old_text: String::new(),
            rows: vec![],
            selections: vec![],
            decorations: vec![],
            predictions: vec![],
            split: false,
            wrap: false,
            read_only: false,
            line_numbers: true,
            line_hover_highlight: "disabled".into(),
            hover_colors: HashMap::new(),
            indicators: "bars".into(),
            font_family: "SF Mono".into(),
            font_size: 13.,
            line_height: 20.,
            tab_size: 2,
            gutter: 48.,
            gutter_utility_width: 0.,
            foreground: "#d4d4d4".into(),
            background: "#141415".into(),
            number_color: "#858585".into(),
            selection_color: "#316dca60".into(),
            caret_color: "#ffffff".into(),
            separator_color: "#242426".into(),
            annotation_background: "#202022".into(),
            separator_foreground: "#999999".into(),
            addition: "#5ecc71".into(),
            deletion: "#ff6762".into(),
            buffer: "#202022".into(),
            active_line: "#ffffff08".into(),
            active_owner: String::new(),
            focus_request: 0,
            session: 0,
            reset_session_scroll: true,
            document_version: 0,
            revision: 0,
            ack: 0,
            reveal: 0,
            scroll_request: 0,
            scroll_top: 0.,
            scroll_left: 0.,
        }
    }
}
