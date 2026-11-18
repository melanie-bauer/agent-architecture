// A tiny in-process recorder for the demo scripts and tests.
// It is NOT a replacement for tracing (use Mastra Studio for that). It exists so
// tests and the live probe can assert on what each agent saw and which actions ran.
import { CUSTOMER_EMAIL, CUSTOMER_NAME } from '../incident-desk/data/incident-data';

export type ModelCall = {
  agentId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  toolsOffered: number;
  ms: number;
  sawCustomerPII: boolean;
};

export type ActionRecord = {
  tool: string;
  args: unknown;
  gate: 'approved-by-human' | 'no-gate';
  at: string;
};

const g = globalThis as any;
g.__incidentDesk ??= { calls: [] as ModelCall[], actions: [] as ActionRecord[] };

export const recorder = {
  get calls(): ModelCall[] {
    return g.__incidentDesk.calls;
  },
  get actions(): ActionRecord[] {
    return g.__incidentDesk.actions;
  },
  reset() {
    g.__incidentDesk.calls = [];
    g.__incidentDesk.actions = [];
  },
  call(c: ModelCall) {
    g.__incidentDesk.calls.push(c);
  },
  action(a: ActionRecord) {
    g.__incidentDesk.actions.push(a);
  },
  summary() {
    const calls = this.calls;
    return {
      modelCalls: calls.length,
      inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
      outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
      maxToolsOffered: calls.reduce((m, c) => Math.max(m, c.toolsOffered), 0),
      agentsThatSawPII: [...new Set(calls.filter((c) => c.sawCustomerPII).map((c) => c.agentId))] as string[],
      ungatedWrites: this.actions.filter((a) => a.gate === 'no-gate').map((a) => a.tool),
      approvedWrites: this.actions.filter((a) => a.gate === 'approved-by-human').map((a) => a.tool),
    };
  },
};

export function promptContainsPII(prompt: unknown): boolean {
  const t = JSON.stringify(prompt ?? '');
  return t.includes(CUSTOMER_EMAIL) || t.includes(CUSTOMER_NAME);
}
