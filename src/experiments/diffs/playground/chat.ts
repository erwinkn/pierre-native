import type { Snippet } from "./model";
export type ChatRequest = { question: string; snippets: readonly Snippet[] };
export class PlaygroundChat {
  readonly store = {
    chat: { id: "demo", draft: "" },
    state: { busy: {} as Record<string, boolean> },
  };
  constructor(readonly onSend?: (request: ChatRequest) => Promise<void>) {}
  async send(snippets: readonly Snippet[]) {
    if (!this.onSend)
      throw Error("Configure a chat callback to send selected code.");
    this.store.state.busy.demo = true;
    try {
      await this.onSend({ question: this.store.chat.draft, snippets });
    } finally {
      this.store.state.busy.demo = false;
    }
  }
  dispose() {}
}
