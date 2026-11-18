// The tools of the Incident Desk, grouped by RISK TIER.
//   read          -> can run anywhere, no side effects
//   write         -> side effect, reversible (restart, rollback)  -> human approval
//   irreversible  -> cannot be undone (public status post)         -> human approval, and never on a subagent
//
// Every tool that is not read-only needs a human (requireApproval). Who gets which tool is decided in agents/.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { deploys, logs, metrics, runbooks } from '../data/incident-data';
import { recorder } from '../../model/recorder';

export type Tier = 'read' | 'write' | 'irreversible';
export const TOOL_TIERS: Record<string, Tier> = {};

const svc = z.string().describe('Service name, e.g. "checkout", "search", "payment-gateway"');

function def<I extends z.ZodTypeAny>(key: string, tier: Tier, description: string, inputSchema: I, run: (input: z.infer<I>) => unknown) {
  TOOL_TIERS[key] = tier;
  return createTool({
    id: key,
    description: tier === 'read' ? description : `${description} [${tier.toUpperCase()}]`,
    inputSchema,
    requireApproval: tier !== 'read',
    execute: async (input: any) => {
      if (tier !== 'read') recorder.action({ tool: key, args: input, gate: 'approved-by-human', at: new Date().toISOString() });
      return run(input) as any;
    },
  });
}

export function buildTools() {
  return {
    // ---------- read: the specialists' tools, plus runbooks for the commander ----------
    searchLogs: def('searchLogs', 'read', 'Search recent log lines of a service', z.object({ service: svc, level: z.enum(['INFO', 'WARN', 'ERROR']).optional() }), ({ service, level }) =>
      logs.filter((l) => l.service === service && (!level || l.level === level)),
    ),
    getMetrics: def('getMetrics', 'read', 'Error rate and latency of a service for the last 20 minutes', z.object({ service: svc }), ({ service }) => metrics[service] ?? { error: 'unknown service' }),
    listDeploys: def('listDeploys', 'read', 'List recent deploys of a service', z.object({ service: svc }), ({ service }) =>
      deploys.filter((d) => d.service === service).map(({ diff, ...d }) => d),
    ),
    getDeployDiff: def('getDeployDiff', 'read', 'Show the config/code diff of a deploy version', z.object({ version: z.string() }), ({ version }) => deploys.find((d) => d.version === version) ?? { error: 'unknown version' }),
    searchRunbooks: def('searchRunbooks', 'read', 'Search operational runbooks', z.object({ query: z.string() }), () => runbooks),

    // ---------- write (reversible) ----------
    restartService: def('restartService', 'write', 'Restart all pods of a service', z.object({ service: svc }), ({ service }) => ({ ok: true, restarted: service })),
    rollbackDeploy: def('rollbackDeploy', 'write', 'Roll a service back to an earlier version', z.object({ service: svc, toVersion: z.string() }), (i) => ({ ok: true, rolledBack: i })),

    // ---------- irreversible ----------
    postStatusUpdate: def('postStatusUpdate', 'irreversible', 'Publish a message on the PUBLIC status page', z.object({ message: z.string() }), () => ({ ok: true, published: true })),
  };
}

export type ToolSet = ReturnType<typeof buildTools>;

/** Pick a subset by key, keeps types. */
export function pick<K extends keyof ToolSet>(set: ToolSet, ...keys: K[]): Pick<ToolSet, K> {
  return Object.fromEntries(keys.map((k) => [k, set[k]])) as Pick<ToolSet, K>;
}
