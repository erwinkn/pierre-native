export const oldFile = {
  name: "src/agent.ts",
  contents: `import { Agent, type Tool } from "./runtime";

export interface AgentOptions {
  model: string;
  tools: Tool[];
}

export async function runAgent(options: AgentOptions) {
  const agent = new Agent(options.model);
  const result = await agent.run("Hello world");
  return result.text;
}
`,
};
export const newFile = {
  name: "src/agent.ts",
  contents: `import { Agent, type Tool } from "./runtime";

export interface AgentOptions {
  model: string;
  tools: Tool[];
  signal?: AbortSignal;
}

export async function runAgent(options: AgentOptions) {
  const agent = new Agent(options.model, options.tools);
  const result = await agent.run("Hello world", {
    signal: options.signal,
    stream: true,
  });
  return result.text;
}
`,
};
