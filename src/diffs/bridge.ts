import type { CodeRow, CodeCell } from "./layout";
export type DocumentSpec = {
  documentVersion?: number;
  rows: CodeRow[];
  text: string;
  oldText: string;
  [key: string]: unknown;
};
export type DocumentPatch = {
  base: number;
  version: number;
  start: number;
  deleteCount: number;
  rows: CodeRow[];
  text?: string;
  textEdit?: { start: number; end: number; text: string };
  oldText?: string;
  chain?: DocumentPatch[];
  shift: { additions: [number, number]; deletions: [number, number] };
};
function sameCell(
  a: CodeCell | undefined,
  b: CodeCell | undefined,
  positions: boolean,
) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.owner === b.owner &&
      a.text === b.text &&
      a.tokens === b.tokens &&
      a.side === b.side &&
      a.kind === b.kind &&
      a.background === b.background &&
      a.gutterBackground === b.gutterBackground &&
      a.numberColor === b.numberColor &&
      (!positions || (a.start === b.start && a.number === b.number)))
  );
}
function sameRow(a: CodeRow, b: CodeRow, positions: boolean) {
  return (
    a.sticky === b.sticky &&
    a.separatorStyle === b.separatorStyle &&
    a.marginTop === b.marginTop &&
    a.owner === b.owner &&
    a.slotInset === b.slotInset &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.action === b.action &&
    a.height === b.height &&
    a.slot === b.slot &&
    a.slotSide === b.slotSide &&
    a.overlay === b.overlay &&
    sameCell(a.left, b.left, positions) &&
    sameCell(a.right, b.right, positions)
  );
}
function textDelta(
  before: DocumentSpec,
  after: DocumentSpec,
  start: number,
  suffix: number,
): Pick<DocumentPatch, "text" | "textEdit"> {
  if (before.text === after.text) return {};
  const first = (rows: CodeRow[], index: number) => {
    for (let i = index; i < rows.length; i++)
      for (const cell of [rows[i].left, rows[i].right])
        if (cell?.side === "additions" && cell.start !== undefined)
          return cell.start;
  };
  const a = first(before.rows, start),
    b = first(after.rows, start),
    end = first(before.rows, before.rows.length - suffix) ?? before.text.length,
    nextEnd =
      first(after.rows, after.rows.length - suffix) ?? after.text.length;
  if (
    a !== undefined &&
    a === b &&
    before.text.slice(0, a) === after.text.slice(0, a) &&
    before.text.slice(end) === after.text.slice(nextEnd)
  )
    return { textEdit: { start: a, end, text: after.text.slice(a, nextEnd) } };
  return { text: after.text };
}
/** Pending deltas form a chain. GPUI can apply them after skipped frames or delayed acknowledgements. */
export class DocumentBridge {
  #next = 0;
  #settings = "";
  #base?: DocumentSpec;
  #ack?: { version: number; spec: DocumentSpec };
  #pending = new Map<number, DocumentSpec>();
  #patches = new Map<number, DocumentPatch>();
  #last?: DocumentSpec;
  #output?: { spec: DocumentSpec; patch: DocumentPatch | null };
  acknowledge(version: number) {
    const spec = this.#pending.get(version);
    if (!spec || (this.#ack && version <= this.#ack.version)) return;
    this.#ack = { version, spec };
    for (const key of this.#pending.keys())
      if (key <= version) {
        this.#pending.delete(key);
        this.#patches.delete(key);
      }
  }
  update(spec: DocumentSpec) {
    if (spec === this.#last && this.#output) return this.#output;
    const previous = this.#last,
      previousVersion = this.#next;
    this.#last = spec;
    const { rows, text, oldText, ...rest } = spec,
      settings = JSON.stringify(rest);
    const version = ++this.#next;
    if (
      !this.#base ||
      !this.#ack ||
      settings !== this.#settings ||
      this.#pending.size > 16
    ) {
      this.#settings = settings;
      this.#base = { ...spec, documentVersion: version };
      this.#ack = { version, spec };
      this.#pending.clear();
      this.#patches.clear();
      this.#pending.set(version, spec);
      return (this.#output = { spec: this.#base, patch: null });
    }
    const before = previous!;
    let start = 0,
      suffix = 0;
    while (
      start < before.rows.length &&
      start < rows.length &&
      sameRow(before.rows[start], rows[start], true)
    )
      start++;
    while (
      suffix < before.rows.length - start &&
      suffix < rows.length - start &&
      sameRow(
        before.rows[before.rows.length - 1 - suffix],
        rows[rows.length - 1 - suffix],
        false,
      )
    )
      suffix++;
    const shift: DocumentPatch["shift"] = {
      additions: [0, 0],
      deletions: [0, 0],
    };
    const found = new Set<string>();
    for (let i = 0; i < suffix && found.size < 2; i++) {
      const a = before.rows[before.rows.length - suffix + i],
        b = rows[rows.length - suffix + i];
      for (const pair of [
        [a.left, b.left],
        [a.right, b.right],
      ]) {
        const [a, b] = pair;
        if (
          a &&
          b &&
          !found.has(a.side) &&
          a.start !== undefined &&
          b.start !== undefined
        ) {
          shift[a.side] = [
            b.start - a.start,
            (b.number ?? 0) - (a.number ?? 0),
          ];
          found.add(a.side);
        }
      }
    }
    const patch: DocumentPatch = {
      base: previousVersion,
      version,
      start,
      deleteCount: before.rows.length - start - suffix,
      rows: rows.slice(start, rows.length - suffix),
      shift,
      ...textDelta(before, spec, start, suffix),
      oldText: oldText === before.oldText ? undefined : oldText,
    };
    this.#pending.set(version, spec);
    this.#patches.set(version, patch);
    return (this.#output = {
      spec: this.#base,
      patch: { ...patch, chain: [...this.#patches.values()] },
    });
  }
}
