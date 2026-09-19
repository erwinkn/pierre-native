import { EncodedTokenMetadata, INITIAL, type StateStack } from "shiki/textmate";
import { getFiletypeFromFileName } from "../../vendor/pierre/src/utils/getFiletypeFromFileName";
import {
  createHighlighter,
  bundledLanguages,
  type BundledLanguage,
  type ThemeRegistration,
  type LanguageRegistration,
} from "shiki";
import dark from "@pierre/theme/pierre-dark";
import light from "@pierre/theme/pierre-light";
import type { FileContents } from "./core";
const common = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "css",
  "html",
  "markdown",
  "rust",
  "python",
  "bash",
  "go",
  "java",
  "c",
  "cpp",
  "yaml",
  "toml",
  "sql",
  "diff",
  "xml",
] as BundledLanguage[];
/** Complete grammar and font preparation before mounting local content. */
export const highlighter = await createHighlighter({
  themes: [
    dark as unknown as ThemeRegistration,
    light as unknown as ThemeRegistration,
  ],
  langs: common,
});
export function languageFor(file: FileContents): string {
  return file.lang ?? getFiletypeFromFileName(file.name);
}
export async function prepareLanguages(files: FileContents[]) {
  const languages = [...new Set(files.map(languageFor))].filter(
    (l) =>
      l !== "text" &&
      l !== "ansi" &&
      !highlighter.getLoadedLanguages().includes(l),
  );
  await Promise.all(
    languages.map((l) => highlighter.loadLanguage(l as BundledLanguage)),
  );
}
export type NativeToken = {
  start: number;
  end: number;
  color: string;
  background?: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  ignoredForBrackets?: boolean;
};
type TokenizedFile = {
  source: string;
  lines: string[];
  tokens: NativeToken[][];
  states: StateStack[];
};
const cache = new Map<string, TokenizedFile>();
export const highlightStats = { tokenizedLines: 0, reusedLines: 0 };
/** Keep TextMate state per line. Stop when the grammar returns to the unchanged suffix state. */
export function highlight(
  file: FileContents,
  theme: string,
  channel = "file",
  limits: { tokenizeMaxLineLength?: number; tokenizeMaxLength?: number } = {},
): NativeToken[][] {
  const maxLine = limits.tokenizeMaxLineLength ?? 1000,
    maxLength = limits.tokenizeMaxLength ?? 100000;
  const lang = languageFor(file),
    key = `${theme}\0${lang}\0${file.name}\0${channel}\0${maxLine}\0${maxLength}`;
  const previous = cache.get(key);
  if (previous?.source === file.contents) return previous.tokens;
  if (lang === "ansi") {
    const source = highlighter.codeToTokens(file.contents, {
      lang: "ansi",
      theme,
    }).tokens;
    const tokens = source.map((line) => {
      let offset = 0;
      return line.map((token) => {
        const start = offset;
        offset += token.content.length;
        return {
          start,
          end: offset,
          color: token.color ?? highlighter.getTheme(theme).fg,
          background: token.bgColor,
          italic: !!((token.fontStyle ?? 0) & 1),
          bold: !!((token.fontStyle ?? 0) & 2),
          underline: !!((token.fontStyle ?? 0) & 4),
        };
      });
    });
    cache.set(key, {
      source: file.contents,
      lines: file.contents.split(/\r\n|\r|\n/),
      tokens,
      states: [],
    });
    while (cache.size > 24) cache.delete(cache.keys().next().value!);
    return tokens;
  }
  if (
    lang !== "text" &&
    lang !== "ansi" &&
    !highlighter.getLoadedLanguages().includes(lang)
  )
    throw Error(
      `Prepare ${lang} with prepareLanguages before mounting ${file.name}.`,
    );
  const lines = file.contents.split(/\r\n|\r|\n/),
    tokens: NativeToken[][] = [],
    states: StateStack[] = [INITIAL];
  const { colorMap } = highlighter.setTheme(theme);
  const grammar =
    lang === "text" || lang === "ansi"
      ? undefined
      : highlighter.getLanguage(lang as BundledLanguage);
  let prefix = 0,
    suffix = 0;
  if (previous) {
    while (
      prefix < lines.length &&
      prefix < previous.lines.length &&
      lines[prefix] === previous.lines[prefix]
    )
      prefix++;
    while (
      suffix < lines.length - prefix &&
      suffix < previous.lines.length - prefix &&
      lines[lines.length - 1 - suffix] ===
        previous.lines[previous.lines.length - 1 - suffix]
    )
      suffix++;
    for (let i = 0; i < prefix; i++) {
      tokens[i] = previous.tokens[i];
      states[i + 1] = previous.states[i + 1];
    }
    highlightStats.reusedLines += prefix;
  }
  for (let i = prefix; i < lines.length; i++) {
    const oldIndex = previous ? previous.lines.length - (lines.length - i) : -1;
    if (
      previous &&
      i >= lines.length - suffix &&
      states[i].equals(previous.states[oldIndex])
    ) {
      for (let j = i, k = oldIndex; j < lines.length; j++, k++) {
        tokens[j] = previous.tokens[k];
        states[j + 1] = previous.states[k + 1];
      }
      highlightStats.reusedLines += lines.length - i;
      break;
    }
    const text = lines[i];
    highlightStats.tokenizedLines++;
    if (!grammar || text.length > maxLine || lines.length > maxLength) {
      tokens[i] = text
        ? [
            {
              start: 0,
              end: text.length,
              color: highlighter.getTheme(theme).fg,
            },
          ]
        : [];
      states[i + 1] = states[i];
      continue;
    }
    const result = grammar.tokenizeLine2(text, states[i], 500);
    states[i + 1] = result.ruleStack;
    const output: NativeToken[] = [];
    for (let j = 0; j < result.tokens.length; j += 2) {
      const start = result.tokens[j],
        end = Math.min(result.tokens[j + 2] ?? text.length, text.length),
        metadata = result.tokens[j + 1],
        style = EncodedTokenMetadata.getFontStyle(metadata);
      if (end <= start) continue;
      output.push({
        start,
        end,
        color: colorMap[EncodedTokenMetadata.getForeground(metadata)],
        italic: !!(style & 1),
        bold: !!(style & 2),
        underline: !!(style & 4),
        ignoredForBrackets: EncodedTokenMetadata.getTokenType(metadata) > 0,
      });
    }
    tokens[i] = output;
  }
  cache.delete(key);
  cache.set(key, { source: file.contents, lines, tokens, states });
  while (cache.size > 24) cache.delete(cache.keys().next().value!);
  return tokens;
}
export function registerTheme(theme: ThemeRegistration) {
  highlighter.loadTheme(theme);
  cache.clear();
}

export async function registerLanguage(language: LanguageRegistration) {
  await highlighter.loadLanguage(language);
  cache.clear();
}
