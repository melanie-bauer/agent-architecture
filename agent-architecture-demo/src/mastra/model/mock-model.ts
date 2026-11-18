// Scripted "model" for offline demos and deterministic tests.
// It implements the AI SDK LanguageModelV3 interface, so Mastra treats it like any provider.
// Each agent gets a small decision function: given what the model would see
// (offered tools, previous tool results, user text) it returns the next tool call or text.
//
// Mock mode proves the ARCHITECTURE (what is wired, what is gated, who sees what).
// It proves nothing about model behaviour. Numbers in mock mode are estimates (chars/4).

export type MockCtx = {
  agentId: string;
  tools: string[];
  toolResults: { toolName: string; output: string }[];
  /** tool results since the last user message (= this turn) */
  turnToolResults: { toolName: string; output: string }[];
  userText: string;
  lastUserText: string;
  systemText: string;
  wantsJson: boolean;
  callIndex: number;
};

export type MockAction =
  | { tool: string; args: Record<string, unknown> }
  | { parallel: { tool: string; args: Record<string, unknown> }[] } // several tool calls in one step (the model fans out)
  | { text: string }
  | { json: unknown };
export type MockScript = (ctx: MockCtx) => MockAction;

let seq = 0;
const latencyMs = () => Number(process.env.MOCK_LATENCY_MS ?? 250);

function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p: any) => (p.type === 'text' ? p.text : p.type === 'tool-result' ? JSON.stringify(p.output ?? p.result ?? '') : ''))
    .join('\n');
}

export function mockModel(agentId: string, script: MockScript) {
  let callIndex = 0;
  const decide = (options: any) => {
    const prompt: any[] = options.prompt ?? [];
    const tools: string[] = (options.tools ?? []).map((t: any) => t.name);
    const toolResults = prompt
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.content)
      .filter((p: any) => p.type === 'tool-result')
      .map((p: any) => ({ toolName: p.toolName, output: JSON.stringify(p.output ?? '') }));
    const lastUserIdx = prompt.map((m) => m.role).lastIndexOf('user');
    const turnToolResults = prompt
      .slice(lastUserIdx + 1)
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.content)
      .filter((p: any) => p.type === 'tool-result')
      .map((p: any) => ({ toolName: p.toolName, output: JSON.stringify(p.output ?? '') }));
    const userTexts = prompt.filter((m) => m.role === 'user').map((m) => textOf(m.content));
    const userText = userTexts.join('\n');
    const lastUserText = userTexts.at(-1) ?? '';
    const systemText = prompt.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
    const wantsJson = options.responseFormat?.type === 'json';
    const ctx: MockCtx = { agentId, tools, toolResults, turnToolResults, userText, lastUserText, systemText, wantsJson, callIndex: callIndex++ };
    const action = script(ctx);
    const inputTokens = Math.round((JSON.stringify(prompt).length + JSON.stringify(options.tools ?? []).length) / 4);
    return { action, inputTokens };
  };

  const usage = (input: number, output: number) => ({
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  });

  return {
    specificationVersion: 'v3' as const,
    provider: 'mock',
    modelId: `mock/${agentId}`,
    supportedUrls: {},
    async doGenerate(options: any) {
      const { action, inputTokens } = decide(options);
      await new Promise((r) => setTimeout(r, latencyMs()));
      if ('parallel' in action) {
        return {
          content: action.parallel.map((c) => ({ type: 'tool-call', toolCallId: `mock_${++seq}`, toolName: c.tool, input: JSON.stringify(c.args) })),
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: usage(inputTokens, 30 * action.parallel.length),
          warnings: [],
        };
      }
      if ('tool' in action) {
        return {
          content: [{ type: 'tool-call', toolCallId: `mock_${++seq}`, toolName: action.tool, input: JSON.stringify(action.args) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: usage(inputTokens, 30),
          warnings: [],
        };
      }
      const text = 'json' in action ? JSON.stringify(action.json) : action.text;
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(inputTokens, Math.ceil(text.length / 4)),
        warnings: [],
      };
    },
    async doStream(options: any) {
      const { action, inputTokens } = decide(options);
      const parts: any[] = [{ type: 'stream-start', warnings: [] }];
      let finish = 'stop';
      let out = 30;
      if ('parallel' in action) {
        for (const c of action.parallel) parts.push({ type: 'tool-call', toolCallId: `mock_${++seq}`, toolName: c.tool, input: JSON.stringify(c.args) });
        finish = 'tool-calls';
      } else if ('tool' in action) {
        parts.push({ type: 'tool-call', toolCallId: `mock_${++seq}`, toolName: action.tool, input: JSON.stringify(action.args) });
        finish = 'tool-calls';
      } else {
        const text = 'json' in action ? JSON.stringify(action.json) : action.text;
        const id = `txt_${++seq}`;
        parts.push({ type: 'text-start', id });
        // stream in small chunks so the UI shows real streaming
        for (const chunk of text.match(/.{1,24}/gs) ?? []) parts.push({ type: 'text-delta', id, delta: chunk });
        parts.push({ type: 'text-end', id });
        out = Math.ceil(text.length / 4);
      }
      parts.push({ type: 'finish', finishReason: { unified: finish, raw: finish }, usage: usage(inputTokens, out) });
      const delay = latencyMs();
      return {
        stream: new ReadableStream({
          async start(c) {
            await new Promise((r) => setTimeout(r, delay));
            for (const p of parts) {
              c.enqueue(p);
              if (p.type === 'text-delta' && delay > 0) await new Promise((r) => setTimeout(r, 15));
            }
            c.close();
          },
        }),
      };
    },
  };
}
