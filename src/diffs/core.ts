// Browser-independent Pierre algorithms. The native renderer never imports the web components.
export { parseDiffFromFile } from "../../vendor/pierre/src/utils/parseDiffFromFile";
export { parsePatchFiles } from "../../vendor/pierre/src/utils/parsePatchFiles";
export { iterateOverDiff } from "../../vendor/pierre/src/utils/iterateOverDiff";
export { diffAcceptRejectHunk } from "../../vendor/pierre/src/utils/diffAcceptRejectHunk";
export { parseMergeConflictDiffFromFile } from "../../vendor/pierre/src/utils/parseMergeConflictDiffFromFile";
export { resolveConflict } from "../../vendor/pierre/src/utils/resolveConflict";
export { TextDocument } from "../../vendor/pierre/src/editor/textDocument";
export type {
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
  BaseDiffOptions,
  SelectedLineRange,
  LineAnnotation,
  DiffLineAnnotation,
  SelectionSide,
  ParsedPatch,
  DiffAcceptRejectHunkType,
  DiffAcceptRejectHunkConfig,
  ConflictResolverTypes,
} from "../../vendor/pierre/src/types";
export type {
  EditorSelection,
  Position,
  Range,
  TextEdit,
  ResolvedTextEdit,
} from "../../vendor/pierre/src/editor/types";
