/// <reference path="./assets.d.ts" />
export * from "./diffs";
export {
  UIProvider as DiffProvider,
  renderDefaultPart,
  type PartData,
  type PartRenderer,
} from "./components/foundation";
export { darkTheme, lightTheme, type UITheme } from "./components/theme";
export { configureClipboard, type Clipboard } from "./platform";
