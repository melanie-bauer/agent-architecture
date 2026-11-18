// Who can do what: read from the agents themselves (not a hand-written list), served to the Desk UI via /desk/info.
import { TOOL_TIERS, type Tier } from '../tools';

export type RosterTool = { name: string; tier: Tier; needsApproval: boolean };
export type RosterAgent = { id: string; tools: RosterTool[] };

const toolsOf = async (agent: any): Promise<RosterTool[]> =>
  Object.entries(await agent.listTools()).map(([name, t]: [string, any]) => ({
    name,
    tier: TOOL_TIERS[name] ?? 'read',
    needsApproval: !!t.requireApproval,
  }));

export async function deskRoster(mastra: any, agentKey = 'incidentCommander'): Promise<RosterAgent[]> {
  const top = mastra.getAgent(agentKey);
  const out: RosterAgent[] = [{ id: agentKey, tools: await toolsOf(top) }];
  for (const [id, sub] of Object.entries(await top.listAgents())) out.push({ id, tools: await toolsOf(sub) });
  return out;
}
