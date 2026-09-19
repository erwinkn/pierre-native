export type Clipboard = {
  writeText(text: string): void | Promise<void>;
  readText(): string | Promise<string>;
};
let clipboard: Clipboard = {
  writeText: (text) => navigator.clipboard.writeText(text),
  readText: () => navigator.clipboard.readText(),
};
/** Native hosts supply their platform clipboard; browsers use the Clipboard API. */
export function configureClipboard(adapter: Clipboard) {
  clipboard = adapter;
}
export const systemClipboard: Clipboard = {
  writeText: (text) => clipboard.writeText(text),
  readText: () => clipboard.readText(),
};
export const copyText = async (text: string) => {
  await systemClipboard.writeText(text);
};
export const isMac =
  typeof navigator !== "undefined"
    ? /Mac|iPhone|iPad/.test(navigator.platform)
    : typeof process !== "undefined" && process.platform === "darwin";
export async function loadAsset(path: string): Promise<Uint8Array> {
  const runtime = Reflect.get(globalThis, "Bun");
  const bytes = runtime
    ? await runtime.file(path).arrayBuffer()
    : await fetch(path).then((response) => {
        if (!response.ok)
          throw Error(`Asset load failed: ${path} (${response.status})`);
        return response.arrayBuffer();
      });
  const buffer = Reflect.get(globalThis, "Buffer");
  return buffer ? buffer.from(bytes) : new Uint8Array(bytes);
}
export async function imageAsset(path: string): Promise<string> {
  const bytes = await loadAsset(path);
  const buffer = Reflect.get(globalThis, "Buffer");
  if (buffer)
    return "data:image/jpeg;base64," + buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "data:image/jpeg;base64," + btoa(binary);
}
