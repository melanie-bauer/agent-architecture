// Runs the three planner modes in-process (PLANNER_TRANSPORT=local) and prints the visualisation events.
process.env.DEMO_MODE ??= 'mock';
process.env.MOCK_LATENCY_MS ??= '0';
process.env.PLANNER_TRANSPORT ??= 'local';
process.env.INCIDENT_DESK_TRACES ??= ':memory:';
process.env.INCIDENT_DESK_QUIET = '1';
const { plannerSingle, plannerTriage, plannerEntryPeer } = await import('../src/mastra/planner/agents');
await import('../src/mastra/index');
const { bus, emit } = await import('../src/mastra/planner/viz');
const counts: Record<string, any> = {};
let mode = '';
bus.on('event', (e: any) => {
  const c = (counts[mode] ??= { agents: new Set(), tools: 0, messages: 0, board: 0, edges: [] as string[] });
  if (e.type === 'agent-start') c.agents.add(e.agent);
  if (e.type === 'tool') c.tools++;
  if (e.type === 'message') { c.messages++; c.edges.push(`${e.from}→${e.to}`); }
  if (e.type === 'board') c.board++;
});
const ask = 'Plan VibeKode 2027: 600 attendees, 3 tracks, 2 days, budget €180k. Draft plan with rooms, schedule, catering, travel, cost and risks.';
for (const [m, agent] of [['single', plannerSingle], ['centralized', plannerTriage], ['decentralized', plannerEntryPeer]] as const) {
  mode = m;
  emit({ type: 'reset', mode: m });
  const r = await (agent as any).generate(ask, { maxSteps: 40 });
  const c = counts[m];
  console.log(`\n== ${m}: agents=${[...c.agents].join(',')} tools=${c.tools} messages=${c.messages} board=${c.board}\n   edges: ${c.edges.join(' ')}\n${r.text.split("\n").slice(0, 12).join('\n')}`);
}
process.exit(0);
