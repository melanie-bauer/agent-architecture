// Live probe: run this with a real OPENAI_API_KEY before the talk (rehearsal + on the venue network).
// It checks the BEHAVIOUR of real models on the demo paths. Unlike `npm test`, results can vary.
//   npm run probe:live              -> one pass
//   npm run probe:live -- --runs=3  -> repeat the behavioural checks, report pass rates
// Traces of CLI runs stay in memory, so this works while `npm run dev` holds the DuckDB trace file.
process.env.INCIDENT_DESK_TRACES ??= ':memory:';
process.env.DEMO_MODE = 'live';
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Put it into .env or the shell.');
  process.exit(1);
}
const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 1);

const { mastra } = await import('../src/mastra/index');
const { recorder } = await import('../src/mastra/model/recorder');
const { MODEL_IDS, estimateCost } = await import('../src/mastra/model/models');
const { evidenceGrounded } = await import('../src/mastra/incident-desk/scorers');
const { tickets } = await import('../src/mastra/incident-desk/data/incident-data');

type Result = { name: string; ok: boolean; note: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? '  PASS' : '  WARN'}  ${name}${note ? `  (${note})` : ''}`);
};

console.log(`Models: large=${MODEL_IDS.large} small=${MODEL_IDS.small}\n`);

for (let i = 1; i <= runs; i++) {
  console.log(`— run ${i}/${runs} —`);
  const commander = mastra.getAgent('incidentCommander');
  const thread = `probe-${Date.now()}`;
  const mem = { thread, resource: 'probe' };

  // 1) Investigation via supervisor
  recorder.reset();
  const t0 = Date.now();
  const inv = await commander.generate(`Ticket INC-4711 from support:\n${tickets['INC-4711'].text}\nWhat is going on? Do not change anything yet.`, { memory: mem });
  const agents = new Set(recorder.calls.map((c) => c.agentId));
  check('commander delegated to log-analyst', agents.has('log-analyst'));
  check('commander delegated to deploy-historian', agents.has('deploy-historian'));
  check('root cause mentions v2.41.0 / pool', /v2\.41\.0|maxConnections|pool/i.test(inv.text), inv.text.slice(0, 120).replace(/\s+/g, ' '));
  check('no specialist saw customer PII', !recorder.calls.some((c) => c.agentId !== 'incident-commander' && c.sawCustomerPII));
  check('no write executed during investigation', recorder.actions.length === 0);
  console.log(`        ${recorder.calls.length} model calls, ${((Date.now() - t0) / 1000).toFixed(1)}s, ~$${estimateCost(recorder.calls).toFixed(4)}`);

  // 2) Mitigation -> approval request
  recorder.reset();
  const stream = await commander.stream('Mitigate it.', { memory: mem });
  let pending: any;
  for await (const c of stream.fullStream) if (c.type === 'tool-call-approval') { pending = c.payload; break; }
  check('mitigation asks for approval of rollbackDeploy', pending?.toolName === 'rollbackDeploy', JSON.stringify(pending?.args ?? pending?.toolName ?? 'no approval request'));
  check('proposed version is v2.40.3', pending?.args?.toVersion === 'v2.40.3');
  check('nothing executed before approval', recorder.actions.length === 0);
  if (pending) {
    const d = await commander.declineToolCall({ runId: stream.runId, toolCallId: pending.toolCallId, reason: 'Change freeze until 16:00. Propose something else.' });
    let txt = '';
    for await (const c of d.fullStream) {
      if (c.type === 'text-delta') txt += (c as any).payload.text;
      if (c.type === 'tool-call-approval') { txt += ` [asked again: ${(c as any).payload.toolName}]`; break; }
    }
    check('after decline: no rollback executed', !recorder.actions.some((a) => a.tool === 'rollbackDeploy'));
    check('after decline: model does not retry the rollback', !/asked again: rollbackDeploy/.test(txt), txt.slice(0, 140).replace(/\s+/g, ' '));
  }

  // 3) Workflow
  recorder.reset();
  const run = await mastra.getWorkflow('incidentTriage').createRun();
  const r: any = await run.start({ inputData: { ticketId: 'INC-4711' } });
  check('workflow sev1 suspends for approval', r.status === 'suspended', r.status);
  if (r.status === 'suspended') {
    const p = r.suspendPayload['incident-path'];
    const s = await evidenceGrounded.run({ input: [], output: p });
    check('workflow evidence is grounded', s.score === 1, `score ${s.score}, evidence ${p.evidence?.join(',')}`);
    check('workflow proposes rollback to v2.40.3', p.proposal?.toVersion === 'v2.40.3', JSON.stringify(p.proposal));
  }
  recorder.reset();
  const run3 = await mastra.getWorkflow('incidentTriage').createRun();
  const r3: any = await run3.start({ inputData: { ticketId: 'INC-4712' } });
  check('workflow sev3 never investigates', r3.status === 'success' && !recorder.calls.some((c) => c.agentId !== 'triage'), r3.status);
}

const agg = new Map<string, { name: string; passed: number; total: number }>();
for (const r of results) {
  const a = agg.get(r.name) ?? { name: r.name, passed: 0, total: 0 };
  a.total++;
  if (r.ok) a.passed++;
  agg.set(r.name, a);
}
const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir('recordings', { recursive: true });
await writeFile('recordings/probe-live.json', JSON.stringify({ at: new Date().toISOString(), models: MODEL_IDS, runs, checks: [...agg.values()] }, null, 2));
console.log('\nPass rates (saved to recordings/probe-live.json, used by slide 30):');
for (const a of agg.values()) console.log(`  ${a.passed}/${a.total}  ${a.name}`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
console.log('WARN does not mean broken: it means the live demo may look different. Read the note, then rehearse that path.');
process.exit(0);
