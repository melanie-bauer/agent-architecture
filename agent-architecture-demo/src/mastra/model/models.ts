// One place that decides which model each agent gets.
//   DEMO_MODE=live  -> OpenAI (needs OPENAI_API_KEY)
//   DEMO_MODE=mock  -> scripted offline model (default when no key is set)
// Every model is wrapped by `recorded()` so scripts/tests can see tokens, tools offered and PII exposure.
import { createOpenAI } from '@ai-sdk/openai';
import { mockModel } from './mock-model';
import { mockScripts } from './mock-scripts';
import { promptContainsPII, recorder } from './recorder';
import { emit as vizEmit, modeOf, nodeOf, vizId } from '../planner/viz';
import { containsPassport, markPassportSeen } from '../planner/passport';
import { reportModelCall } from '../incident-desk/server/desk-tap';

export type Size = 'large' | 'small';

export const demoMode = (): 'live' | 'mock' => {
  const m = process.env.DEMO_MODE;
  if (m === 'live' || m === 'mock') return m;
  return process.env.OPENAI_API_KEY ? 'live' : 'mock';
};

/** The planner example can run in its own mode: PLANNER_MODE=mock keeps the Incident Desk live but scripts the 15 planner agents. */
export const plannerMode = (): 'live' | 'mock' => {
  const m = process.env.PLANNER_MODE;
  return m === 'live' || m === 'mock' ? m : demoMode();
};

export const MODEL_IDS = {
  // Overridable without code changes, e.g. MODEL_LARGE=gpt-6.1-terra
  large: process.env.MODEL_LARGE ?? 'gpt-6.1-sol',
  small: process.env.MODEL_SMALL ?? 'gpt-6-luna',
};

// Rough $ per 1M tokens [input, output] for the summary table. Check before quoting on stage.
export const PRICES: Record<string, [number, number]> = {
  'gpt-6.1-sol': [2, 10],
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-terra': [1, 5],
};

let openai: ReturnType<typeof createOpenAI> | undefined;

/**
 * The model behind LLM-as-judge scorers. Live only (the scripted mock model cannot judge), and deliberately
 * not wrapped by `recorded()`: the judge is not part of the agent system, so it must not show up in the Desk timeline,
 * token counts or PII checks. MODEL_JUDGE overrides it, by default the large model.
 */
export function judgeModel() {
  openai ??= createOpenAI();
  return openai(process.env.MODEL_JUDGE ?? MODEL_IDS.large);
}

export function model(agentId: string, size: Size) {
  const mode = nodeOf(agentId) ? plannerMode() : demoMode();
  if (mode === 'mock') {
    const script = mockScripts[agentId] ?? mockScripts.default;
    return recorded(agentId, `mock:${MODEL_IDS[size]}`, mockModel(agentId, script));
  }
  openai ??= createOpenAI();
  const inner = openai(MODEL_IDS[size]) as any;
  return recorded(agentId, MODEL_IDS[size], nodeOf(agentId) ? withReasoningEffort(inner) : inner);
}

/**
 * Reasoning effort for the planner agents, sent as an OpenAI provider option of the AI SDK
 * (providerOptions.openai.reasoningEffort). Default "low": measured faster for these planning steps (README, planner timings).
 * PLANNER_REASONING_EFFORT=none|minimal|low|medium|high, or "default" to send nothing and let the model use its own default.
 */
export const plannerReasoningEffort = () => {
  const v = process.env.PLANNER_REASONING_EFFORT;
  return v === undefined || v === '' ? 'low' : v;
};
function withReasoningEffort<M extends { doStream: Function; doGenerate: Function }>(inner: M): M {
  const add = (options: any) => {
    const effort = plannerReasoningEffort();
    if (effort === 'default') return options;
    const openaiOptions = { ...(options.providerOptions?.openai ?? {}), reasoningEffort: effort };
    return { ...options, providerOptions: { ...(options.providerOptions ?? {}), openai: openaiOptions } };
  };
  const src: any = inner;
  return {
    specificationVersion: src.specificationVersion,
    provider: src.provider,
    modelId: src.modelId,
    get supportedUrls() {
      return src.supportedUrls;
    },
    doGenerate: (options: any) => inner.doGenerate(add(options)),
    doStream: (options: any) => inner.doStream(add(options)),
  } as any;
}

function readUsage(u: any): { input: number; output: number } {
  const n = (x: any) => (typeof x === 'number' ? x : (x?.total ?? 0));
  return { input: n(u?.inputTokens), output: n(u?.outputTokens) };
}

/** Pass-through wrapper around an AI SDK language model that records every call. */
export function recorded<M extends { doStream: Function; doGenerate: Function }>(agentId: string, modelId: string, inner: M): M {
  const base = (options: any) => {
    reportModelCall(agentId, options); // Desk UI: what a specialist really received (observation only)
    return {
      agentId,
      modelId,
      toolsOffered: (options.tools ?? []).length,
      sawCustomerPII: promptContainsPII(options.prompt),
    };
  };
  const src: any = inner;
  const wrapper: any = {
    specificationVersion: src.specificationVersion,
    provider: src.provider,
    modelId: src.modelId,
    get supportedUrls() {
      return src.supportedUrls;
    },
  };
  // planner agents report every model call on the viz bus, tagged with their mode, with duration and tokens,
  // and whether the prompt held passport data (measured here, on what the model really gets)
  const node = nodeOf(agentId);
  const mode = modeOf(agentId);
  const passport = (options: any) => {
    const saw = !!node && containsPassport(options.prompt);
    if (saw) markPassportSeen(mode, node!);
    return saw ? { sawPassport: true } : {};
  };
  wrapper.doGenerate = async (options: any) => {
    const t0 = Date.now();
    const call = vizId();
    if (node) vizEmit({ type: 'agent-start', mode, agent: node, call });
    const saw = passport(options);
    const res = await inner.doGenerate(options);
    const u = readUsage(res.usage);
    if (node) vizEmit({ type: 'agent-end', mode, agent: node, call, tokens: u.input + u.output, ms: Date.now() - t0, ...saw });
    recorder.call({ ...base(options), inputTokens: u.input, outputTokens: u.output, ms: Date.now() - t0 });
    return res;
  };
  wrapper.doStream = async (options: any) => {
    const t0 = Date.now();
    const call = vizId();
    if (node) vizEmit({ type: 'agent-start', mode, agent: node, call });
    const saw = passport(options);
    const res = await inner.doStream(options);
    const meta = base(options);
    const stream = res.stream.pipeThrough(
      new TransformStream({
        transform(part: any, ctrl) {
          if (part.type === 'finish') {
            const u = readUsage(part.usage);
            recorder.call({ ...meta, inputTokens: u.input, outputTokens: u.output, ms: Date.now() - t0 });
            if (node) vizEmit({ type: 'agent-end', mode, agent: node, call, tokens: u.input + u.output, ms: Date.now() - t0, ...saw });
          }
          ctrl.enqueue(part);
        },
      }),
    );
    return { ...res, stream };
  };
  return wrapper as M;
}

export function estimateCost(calls: { modelId: string; inputTokens: number; outputTokens: number }[]) {
  return calls.reduce((sum, c) => {
    const id = c.modelId.replace(/^mock:/, '');
    const [pin, pout] = PRICES[id] ?? [0, 0];
    return sum + (c.inputTokens * pin + c.outputTokens * pout) / 1_000_000;
  }, 0);
}
