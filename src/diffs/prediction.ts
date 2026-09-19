import { TextDocument } from "../../vendor/pierre/src/editor/textDocument";
import type { Position } from "../../vendor/pierre/src/editor/types";
import type {
  EditPredictRequest,
  EditPredictResponse,
} from "../../vendor/pierre/src/editor/editPrediction";

function validPosition(
  document: TextDocument<any, any>,
  p: Position | undefined,
) {
  if (
    !p ||
    !Number.isInteger(p.line) ||
    !Number.isInteger(p.character) ||
    p.line < 0 ||
    p.line >= document.lineCount ||
    p.character < 0 ||
    p.character > document.getLineLength(p.line)
  )
    return false;
  const text = document.getLineText(p.line),
    previous = text.charCodeAt(p.character - 1),
    current = text.charCodeAt(p.character);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

/** Apply the source provider limits before a response can reach native rendering. */
export function validatePrediction(
  document: TextDocument<any, any>,
  request: EditPredictRequest,
  response: EditPredictResponse | null | undefined,
): EditPredictResponse | undefined {
  if (
    !response ||
    !Array.isArray(response.edits) ||
    !response.edits.length ||
    response.edits.length > 256 ||
    !response.newCursor
  )
    return;
  const excerpt = document.offsetAt({
    line: request.excerptStartLine,
    character: 0,
  });
  const editableStart = excerpt + request.editableRange.start,
    editableEnd = excerpt + request.editableRange.end;
  let bytes = 0;
  const edits: { start: number; end: number; text: string }[] = [];
  for (const edit of response.edits) {
    if (
      !edit ||
      typeof edit.newText !== "string" ||
      !validPosition(document, edit.range?.start) ||
      !validPosition(document, edit.range?.end)
    )
      return;
    bytes += new TextEncoder().encode(edit.newText).byteLength;
    if (bytes > 128 * 1024) return;
    const start = document.offsetAt(edit.range.start),
      end = document.offsetAt(edit.range.end);
    if (start > end || start < editableStart || end > editableEnd) return;
    const resolved = document.resolveEdits([edit])[0];
    if (resolved.start !== start || resolved.end !== end) return;
    edits.push({ start, end, text: resolved.text });
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  if (edits.some((edit, i) => i > 0 && edits[i - 1].end > edit.start)) return;
  const changed = edits.filter(
    (e) => e.text !== document.getTextSlice(e.start, e.end),
  );
  if (!changed.length) return;
  const normalized = changed.map((e) => ({
    range: {
      start: document.positionAt(e.start),
      end: document.positionAt(e.end),
    },
    newText: e.text,
  }));
  const predicted = new TextDocument(document.uri, document.getText());
  predicted.applyEdits(normalized, false);
  if (!validPosition(predicted, response.newCursor)) return;
  return { edits: normalized, newCursor: { ...response.newCursor } };
}

/** Group edits on shared source lines, as the source overlay does. */
export function predictionGroups(
  document: TextDocument<any, any>,
  response: EditPredictResponse | undefined,
) {
  if (!response) return [];
  const groups: {
    anchor: number;
    head: number;
    prefix: string;
    text: string;
    ghostLength: number;
    line: number;
    endLine: number;
  }[] = [];
  for (let i = 0; i < response.edits.length; ) {
    const first = response.edits[i];
    let last = i,
      endLine = first.range.end.line;
    while (
      last + 1 < response.edits.length &&
      response.edits[last + 1].range.start.line <= endLine
    ) {
      last++;
      endLine = Math.max(endLine, response.edits[last].range.end.line);
    }
    const anchor = document.offsetAt(first.range.start),
      head = document.offsetAt(response.edits[last].range.end);
    let text = "",
      at = anchor;
    for (let j = i; j <= last; j++) {
      const e = response.edits[j];
      text +=
        document.getTextSlice(at, document.offsetAt(e.range.start)) + e.newText;
      at = document.offsetAt(e.range.end);
    }
    const ghostLength = text.length;
    if (text)
      text += document.getTextSlice(
        at,
        document.offsetAt({
          line: endLine,
          character: document.getLineLength(endLine),
        }),
      );
    groups.push({
      anchor,
      head,
      prefix: document
        .getLineText(first.range.start.line)
        .slice(0, first.range.start.character),
      text,
      ghostLength,
      line: first.range.start.line,
      endLine,
    });
    i = last + 1;
  }
  return groups;
}
