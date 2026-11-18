// Observation only: lets the Desk UI show what a specialist's model REALLY received, and each delegation.
//   - The model wrapper (model/models.ts) reports every specialist model call (reportModelCall).
//   - The delegation hooks (agents/delegation.ts) report each delegation's start and answer (reportDelegation).
// If the call runs inside a Desk request (agui-route.ts, workflow-route.ts), the request turns it into a CUSTOM event.
// Nothing here changes what the agents see or do: redaction still happens in agents/delegation.ts.
import { AsyncLocalStorage } from 'node:async_hooks';
import { promptContainsPII } from '../../model/recorder';

export type SpecialistInput = {
  /** delegation name as the supervisor sees it (tool "agent-logAnalyst" -> "logAnalyst") */
  agent: string;
  /** the last user message in the specialist's model prompt, i.e. the request after the delegation hook */
  received: string;
  /** measured on the whole prompt the model got (same check as the tests) */
  sawCustomerPII: boolean;
  /** tool names the model was offered */
  tools: string[];
};

export type Delegation =
  | { phase: 'start'; agent: string; prompt: string }
  | { phase: 'end'; agent: string; ok: boolean; answer: string };

export type DeskTap = { input?: (e: SpecialistInput) => void; delegation?: (e: Delegation) => void };

const SPECIALISTS: Record<string, string> = { 'log-analyst': 'logAnalyst', 'deploy-historian': 'deployHistorian' };

const store = new AsyncLocalStorage<DeskTap>();

/** Run fn with listeners (scoped to this async context, so parallel requests stay apart). */
export const withDeskTap = <T>(tap: DeskTap, fn: () => T): T => store.run(tap, fn);
/** Only specialist inputs (the chat route). */
export const withSpecialistTap = <T>(listener: (e: SpecialistInput) => void, fn: () => T): T => withDeskTap({ input: listener }, fn);

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p: any) => (p?.type === 'text' ? p.text : '')).join('')
      : '';

/** Called by the model wrapper for every model call. Cheap no-op outside a tapped request or for other agents. */
export function reportModelCall(agentId: string, options: any) {
  const agent = SPECIALISTS[agentId];
  const listener = store.getStore()?.input;
  if (!agent || !listener) return;
  const prompt: any[] = Array.isArray(options?.prompt) ? options.prompt : [];
  const lastUser = [...prompt].reverse().find((m) => m.role === 'user');
  const tools = (options?.tools ?? []).map((t: any) => t.name).filter(Boolean);
  listener({ agent, received: textOf(lastUser?.content), sawCustomerPII: promptContainsPII(options?.prompt), tools });
}

/** Called by the delegation hooks. No-op outside a tapped request. */
export function reportDelegation(e: Delegation) {
  store.getStore()?.delegation?.({ ...e, agent: SPECIALISTS[e.agent] ?? e.agent }); // hooks get the agent id (log-analyst)
}
