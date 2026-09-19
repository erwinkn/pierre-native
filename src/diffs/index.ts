export * from "./core";
export * from "./components";
export {
  Editor,
  type NativeEditorOptions,
  type Marker,
  type RemoteCaret,
  type NativeCodeEvent,
} from "./editor";
export { pierreDark, pierreLight, resolveTheme, type DiffTheme } from "./theme";
export {
  prepareLanguages,
  registerTheme,
  registerLanguage,
  languageFor,
} from "./highlight";
export {
  fileRows,
  diffRows,
  wordRanges,
  type DiffOptions,
  type CodeRow,
  type CodeCell,
} from "./layout";
export { EditStateManager } from "../../vendor/pierre/src/editor/EditStateManager";
