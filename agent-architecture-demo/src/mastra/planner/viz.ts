// Server-side event bus for the network visualisation (the Network screen in the planner UI).
// It sees everything because all agents run in one process: like a trace, not like the protocol.
// Over real A2A the caller would only see a task and its result.
//
// Every event that comes from an agent carries the mode of that agent (single, centralized, decentralized),
// derived from the agent id. A browser tab draws only the events of the mode it shows.
// Passport numbers are redacted before an event leaves this module.
import { EventEmitter } from 'node:events';
import { redactDeep } from './passport';

export type PlanMode = 'single' | 'centralized' | 'decentralized';
export const PLAN_MODES: PlanMode[] = ['single', 'centralized', 'decentralized'];

type Tagged = { mode: PlanMode };
export type VizEvent =
  | { type: 'reset'; mode?: string; scope?: 'all' | 'run' | 'network'; request?: string }
  | ({ type: 'agent-start'; agent: string; call: string } & Tagged)
  | ({ type: 'agent-end'; agent: string; call: string; tokens?: number; ms?: number; sawPassport?: boolean } & Tagged)
  | ({ type: 'tool'; agent: string; tool: string; args: unknown; id: string } & Tagged)
  | ({ type: 'tool-result'; agent: string; tool: string; id: string; summary: string; result?: unknown; ms?: number; system?: string } & Tagged)
  | ({ type: 'message'; from: string; to: string; text: string; via: 'delegation' | 'a2a' | 'local'; id: string } & Tagged)
  | ({ type: 'reply'; from: string; to: string; text: string; id: string; ms?: number; redacted?: number; task?: { id: string; contextId?: string; state: string } } & Tagged)
  | ({ type: 'board'; agent: string; section: string; note: string } & Tagged)
  | { type: 'plan'; mode: string; change?: unknown; reset?: boolean }
  | ({ type: 'approval'; id: string; status: string; totalEur: number; by: string; reason?: string } & Tagged);

const g = globalThis as any;
g.__plannerBus ??= new EventEmitter().setMaxListeners(50);
export const bus: EventEmitter = g.__plannerBus;

let seq = 0;
export const vizId = () => `v${++seq}`;
/** Emit an event. Passport numbers never reach the trace: they are replaced with [passport] here. */
export function emit(e: VizEvent) {
  bus.emit('event', redactDeep({ ...e, t: Date.now() }));
}

/** Map internal agent ids to the node names the UI draws. */
export function nodeOf(agentId: string): string | null {
  if (agentId === 'planner-single') return 'single';
  if (agentId === 'planner-triage') return 'triage';
  const m = agentId.match(/^(?:spec|peer)-(.+)$/);
  return m ? m[1] : null;
}

/** Which mode an agent belongs to: planner-single, planner-triage and spec-* (centralized), peer-* (decentralized). */
export function modeOf(agentId: string): PlanMode {
  if (agentId.startsWith('spec-') || agentId === 'planner-triage') return 'centralized';
  if (agentId.startsWith('peer-')) return 'decentralized';
  return 'single';
}
