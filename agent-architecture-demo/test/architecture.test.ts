// DEMO 4: Architecture tests.
// They test the WIRING (who can do what, who sees what, which path is taken),
// not the model's mood. Deterministic, offline, < 10 seconds. Run on every commit.
//   npm test
import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEMO_MODE = 'mock';
process.env.MOCK_LATENCY_MS = '0';
import os from 'node:os';
import path from 'node:path';
process.env.INCIDENT_DESK_DB = `file:${path.join(os.tmpdir(), `incident-desk-test-${process.pid}.db`)}`;
process.env.INCIDENT_DESK_TRACES = ':memory:';
process.env.INCIDENT_DESK_QUIET = '1';
process.env.PLANNER_TRANSPORT = 'local'; // peers/specialists in-process instead of A2A over HTTP
process.env.PLANNER_SYSTEM_LATENCY = '0.005'; // the fake airline and hotel systems wait 20 ms instead of 4 s

const { mastra } = await import('../src/mastra/index');
const { recorder } = await import('../src/mastra/model/recorder');
const { TOOL_TIERS } = await import('../src/mastra/incident-desk/tools/index');
const { delegationPolicy, MAX_DELEGATIONS } = await import('../src/mastra/incident-desk/agents/delegation');
const { evidenceGrounded, rootCauseFound, customerDataKept } = await import('../src/mastra/incident-desk/scorers');
const { tickets } = await import('../src/mastra/incident-desk/data/incident-data');
const { allowedRollbackTargets } = await import('../src/mastra/incident-desk/workflows/incident-triage');

/** Fitness function: list every risky tool an agent (or its subagents) can call without a human. */
async function ungatedRiskyTools(agentKey: string): Promise<string[]> {
  const agent = mastra.getAgent(agentKey as any);
  const tools = await agent.listTools();
  const out = Object.entries(tools)
    .filter(([k, t]: [string, any]) => TOOL_TIERS[k] && TOOL_TIERS[k] !== 'read' && !t.requireApproval)
    .map(([k]) => `${agentKey}.${k}`);
  for (const [subKey, sub] of Object.entries(await agent.listAgents())) {
    const subTools = await (sub as any).listTools();
    for (const k of Object.keys(subTools)) if (TOOL_TIERS[k] !== 'read') out.push(`${agentKey}>${subKey}.${k} (subagent must be read-only)`);
  }
  return out;
}

beforeEach(() => recorder.reset());

describe('Tool boundaries', () => {
  test('incident commander: every risky tool needs a human, specialists are read-only', async () => {
    assert.deepEqual(await ungatedRiskyTools('incidentCommander'), []);
  });

  test('incident investigator (workflow) has no risky tools at all', async () => {
    assert.deepEqual(await ungatedRiskyTools('incidentInvestigator'), []);
  });
});

describe('Human in the loop', () => {
  const ask = (text: string) => mastra.getAgent('incidentCommander').stream(text, { memory: { thread: `t-${Math.random()}`, resource: 'test' } });

  async function untilApproval(stream: any) {
    for await (const chunk of stream.fullStream) if (chunk.type === 'tool-call-approval') return chunk.payload;
    return undefined;
  }

  test('rollback does not execute until approved, and a decline reason reaches the model', async () => {
    const commander = mastra.getAgent('incidentCommander');
    const stream = await ask(`Checkout is failing since 14:05 (INC-4711). Find the cause and mitigate.`);
    const pending = await untilApproval(stream);
    assert.equal(pending?.toolName, 'rollbackDeploy');
    assert.equal(recorder.actions.length, 0, 'nothing may run while waiting for a human');

    const declined = await commander.declineToolCall({ runId: stream.runId, toolCallId: pending.toolCallId, reason: 'Change freeze until 16:00, hotfix instead' });
    let text = '';
    for await (const c of declined.fullStream) if (c.type === 'text-delta') text += c.payload.text;
    assert.equal(recorder.actions.length, 0, 'declined call must not execute');
    assert.match(text, /Change freeze/i, 'the model should see why it was declined');
  });

  test('approve executes exactly the reviewed arguments, once', async () => {
    const commander = mastra.getAgent('incidentCommander');
    const stream = await ask(`Checkout is failing since 14:05 (INC-4711). Find the cause and mitigate.`);
    const pending = await untilApproval(stream);
    const approved = await commander.approveToolCall({ runId: stream.runId, toolCallId: pending.toolCallId });
    for await (const _ of approved.fullStream) { /* drain until next approval or end */ }
    assert.deepEqual(
      recorder.actions.map((a) => [a.tool, a.args, a.gate]),
      [['rollbackDeploy', pending.args, 'approved-by-human']],
    );
  });
});

describe('Context boundaries', () => {
  test('specialists never see customer PII, even when the supervisor pastes it into the delegation', async () => {
    const stream = await mastra.getAgent('incidentCommander').stream(`Investigate this ticket, no action yet:\n${tickets['INC-4711'].text}`, {
      memory: { thread: `t-${Math.random()}`, resource: 'test' },
    });
    for await (const _ of stream.fullStream) { /* run to end */ }
    const specialists = recorder.calls.filter((c) => c.agentId === 'log-analyst' || c.agentId === 'deploy-historian');
    assert.ok(specialists.length > 0, 'specialists should have been called');
    assert.deepEqual(specialists.filter((c) => c.sawCustomerPII).map((c) => c.agentId), []);
  });

  test('delegation budget: counted per supervisor run, refused beyond the budget', async () => {
    const results: any[] = [];
    for (let i = 0; i <= MAX_DELEGATIONS; i++) results.push(await delegationPolicy.onDelegationStart({ runId: 'run-A', prompt: 'x', primitiveId: 'logAnalyst' }));
    assert.deepEqual(results.map((r) => r.proceed), [...Array(MAX_DELEGATIONS).fill(true), false]);
    const other: any = await delegationPolicy.onDelegationStart({ runId: 'run-B', prompt: 'x', primitiveId: 'logAnalyst' });
    assert.equal(other.proceed, true, 'another run has its own budget');
    assert.equal(delegationPolicy.hookErrorStrategy, 'throw', 'the boundary must fail closed');
  });
});

describe('Workflow routing', () => {
  test('sev3 tickets never reach the expensive investigation', async () => {
    const run = await mastra.getWorkflow('incidentTriage').createRun();
    const r: any = await run.start({ inputData: { ticketId: 'INC-4712' } });
    assert.equal(r.status, 'success');
    assert.deepEqual([...new Set(recorder.calls.map((c) => c.agentId))], ['triage']);
  });

  test('execution only accepts allow-listed rollback targets', async () => {
    assert.deepEqual(allowedRollbackTargets('checkout'), ['v2.40.3']);
    assert.ok(!allowedRollbackTargets('checkout').includes('v2.41.0'), 'the broken current version is not a target');
  });

  test('sev1 pauses for a human and nothing changes before that', async () => {
    const run = await mastra.getWorkflow('incidentTriage').createRun();
    const r: any = await run.start({ inputData: { ticketId: 'INC-4711' } });
    assert.equal(r.status, 'suspended');
    assert.equal(recorder.actions.length, 0);
    const proposal = r.suspendPayload['incident-path'];
    const score = await evidenceGrounded.run({ input: [], output: proposal });
    assert.equal(score.score, 1, 'every cited evidence id must exist');
  });
});

describe('Behaviour scorers (sampled on live runs, shown in Studio)', () => {
  test('both supervisors score every run', async () => {
    const inv = await mastra.getAgent('incidentInvestigator').listScorers();
    const cmd = await mastra.getAgent('incidentCommander').listScorers();
    assert.deepEqual((inv as any).rootCauseFound?.sampling, { type: 'ratio', rate: 1 });
    assert.deepEqual((cmd as any).customerDataKept?.sampling, { type: 'ratio', rate: 1 });
    assert.deepEqual((cmd as any).answerJudged?.sampling, { type: 'none' }, 'the LLM judge is off in mock mode: a scripted model cannot judge');
  });

  test('root-cause-found: full, half and no credit', async () => {
    const score = async (text: string) => (await rootCauseFound.run({ input: [], output: text } as any)).score;
    assert.equal(await score('Deploy v2.41.0 lowered maxConnections from 64 to 4, so the payment pool is exhausted.'), 1);
    assert.equal(await score('It started after deploy v2.41.0.'), 0.5);
    assert.equal(await score('Probably the payment provider.'), 0);
  });

  test('customer-data-kept: an answer that repeats customer data scores 0', async () => {
    const score = async (text: string) => (await customerDataKept.run({ input: [], output: text } as any)).score;
    assert.equal(await score('The customer [name] reported 502s; roll back checkout to v2.40.3.'), 1);
    assert.equal(await score('Jana Novak (jana.novak@example.com) reported it.'), 0);
    assert.equal(await score('The payment with card ending 4242 failed.'), 0);
  });
});

describe('Incident Desk UI data (what the server sends to the browser)', () => {
  test('/desk/info roster: read from the agents, specialists read-only, every commander write needs approval', async () => {
    const { deskRoster } = await import('../src/mastra/incident-desk/server/roster');
    const roster = await deskRoster(mastra);
    assert.deepEqual(roster.map((a) => a.id), ['incidentCommander', 'logAnalyst', 'deployHistorian']);
    for (const a of roster.slice(1)) assert.deepEqual(a.tools.filter((t) => t.tier !== 'read'), [], `${a.id} must be read-only`);
    const commander = roster[0].tools;
    assert.ok(commander.some((t) => t.name === 'rollbackDeploy'));
    assert.deepEqual(commander.filter((t) => t.tier !== 'read' && !t.needsApproval), []);
  });

  test('AG-UI stream: the commander sends the email, the specialist receives the redacted request (CUSTOM event)', async () => {
    const { MastraAgent } = await import('@ag-ui/mastra');
    const { runAgui, SPECIALIST_INPUT_EVENT } = await import('../src/mastra/incident-desk/server/agui-route');
    const agent = new MastraAgent({ agent: mastra.getAgent('incidentCommander') as any, resourceId: 'test', subagentVisibility: 'attributed' } as any);
    const input = {
      threadId: `t-${Math.random()}`,
      runId: `r-${Math.random()}`,
      messages: [{ id: 'm1', role: 'user', content: `Investigate this ticket, no action yet:\n${tickets['INC-4711'].text}` }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    };
    const events: any[] = await new Promise((resolve) => {
      const out: any[] = [];
      runAgui(agent, input, (e) => out.push(e), () => resolve(out));
    });
    const sent = events
      .filter((e) => e.type === 'TOOL_CALL_ARGS' && events.find((s) => s.type === 'TOOL_CALL_START' && s.toolCallId === e.toolCallId)?.toolCallName === 'agent-logAnalyst')
      .map((e) => e.delta)
      .join('');
    assert.match(sent, /jana\.novak@example\.com/, 'the mock commander pastes the customer email into the delegation');
    const inputs = events.filter((e) => e.type === 'CUSTOM' && e.name === SPECIALIST_INPUT_EVENT).map((e) => e.value);
    const log = inputs.find((v) => v.agent === 'logAnalyst');
    assert.ok(log, 'one event for what logAnalyst received');
    assert.ok(!log.received.includes('jana.novak@example.com') && log.received.includes('[email]'));
    assert.equal(log.sawCustomerPII, false);
    assert.deepEqual(log.tools, ['searchLogs', 'getMetrics']);
    assert.equal(inputs.filter((v) => v.agent === 'logAnalyst').length, 1, 'one event per request, not per model step');
    const at = (pred: (e: any) => boolean) => events.findIndex(pred);
    assert.ok(at((e) => e.type === 'RUN_STARTED') < at((e) => e.type === 'CUSTOM'));
    assert.ok(at((e) => e.type === 'CUSTOM') < at((e) => e.type === 'RUN_FINISHED'), 'sent inside the run');
  });
});

describe('Incident Desk workflow tab (AG-UI events from the workflow)', () => {
  const collect = async (req: any) => {
    const { runWorkflowAgui } = await import('../src/mastra/incident-desk/server/workflow-route');
    const out: any[] = [];
    await runWorkflowAgui(mastra, req, (e) => out.push(e));
    return out;
  };
  const steps = (events: any[]) => events.filter((e) => e.type === 'STEP_STARTED').map((e) => e.stepName);
  const custom = (events: any[], name: string) => events.filter((e) => e.type === 'CUSTOM' && e.name === name).map((e) => e.value);

  test('sev1: steps stream in order, the run ends with an interrupt, and nothing executes before the human', async () => {
    const events = await collect({ action: 'start', ticketId: 'INC-4711' });
    assert.equal(events[0].type, 'RUN_STARTED');
    assert.deepEqual(steps(events), ['load-ticket', 'classify', 'incident-path', 'incident-path.investigate', 'incident-path.approve-remediation']);
    const ticket = custom(events, 'desk.ticket')[0];
    assert.match(ticket.raw, /jana\.novak@example\.com/, 'the raw ticket is shown as it arrived');
    const loaded = custom(events, 'desk.stepResult').find((r) => r.step === 'load-ticket');
    assert.ok(!loaded.output.text.includes('jana.novak@example.com') && loaded.output.text.includes('[email]'), 'load-ticket removes customer data');
    assert.deepEqual(custom(events, 'desk.delegation').filter((d) => d.phase === 'start').map((d) => d.agent), ['logAnalyst', 'deployHistorian']);
    const inputs = custom(events, 'desk.specialistInput');
    assert.ok(inputs.every((v) => !v.sawCustomerPII));
    assert.deepEqual(inputs.map((v) => v.agent), ['logAnalyst', 'deployHistorian'], 'one event per request, not per model step');
    const last = events.at(-1);
    assert.equal(last.type, 'RUN_FINISHED');
    assert.equal(last.outcome.type, 'interrupt');
    assert.deepEqual(last.outcome.interrupts[0].metadata.workflow.proposal, { type: 'rollback', service: 'checkout', toVersion: 'v2.40.3' });
    assert.equal(recorder.actions.length, 0);
  });

  test('resume from a new request: approve executes the allow-listed rollback once, decline executes nothing', async () => {
    const first = await collect({ action: 'start', ticketId: 'INC-4711' });
    const runId = first.at(-1).runId;
    const approved = await collect({ action: 'resume', runId, approved: true });
    assert.deepEqual(steps(approved), ['incident-path', 'incident-path.approve-remediation', 'incident-path.execute-remediation']);
    assert.equal(approved.at(-1).outcome.type, 'success');
    assert.deepEqual(recorder.actions.map((a) => [a.tool, a.args]), [['rollbackDeploy', { service: 'checkout', toVersion: 'v2.40.3' }]]);

    recorder.reset();
    const second = await collect({ action: 'start', ticketId: 'INC-4711' });
    const declined = await collect({ action: 'resume', runId: second.at(-1).runId, approved: false, comment: 'Change freeze' });
    const outcome = custom(declined, 'desk.stepResult').find((r) => r.step === 'incident-path.execute-remediation').output.outcome;
    assert.match(outcome, /Not executed .*Change freeze/);
    assert.equal(recorder.actions.length, 0);
  });

  test('sev3: the code branch skips the investigation, only triage calls a model', async () => {
    const events = await collect({ action: 'start', ticketId: 'INC-4712' });
    assert.deepEqual(steps(events), ['load-ticket', 'classify', 'create-backlog-item']);
    assert.equal(events.at(-1).outcome.type, 'success');
    assert.deepEqual([...new Set(recorder.calls.map((c) => c.agentId))], ['triage']);
  });

  test('unknown ticket ends with RUN_ERROR, not a hanging stream', async () => {
    const events = await collect({ action: 'start', ticketId: 'INC-0000' });
    assert.equal(events.at(-1).type, 'RUN_ERROR');
  });
});

describe('Planner network (topology)', async () => {
  const { plannerSingle, plannerTriage, plannerEntryPeer, specialists, peers, triageDelegation } = await import('../src/mastra/planner/agents');
  const { bus, emit } = await import('../src/mastra/planner/viz');
  const { MAX_MESSAGES } = await import('../src/mastra/planner/peers');
  const { DOMAINS, WRITE_TOOLS } = await import('../src/mastra/planner/tools');
  const { passports } = await import('../src/mastra/planner/data');
  const { REQUESTS } = await import('../src/mastra/planner/requests');
  const store = await import('../src/mastra/planner/plan-store');
  const ASK = 'Plan VibeKode 2027 for 600 attendees.';
  const MODES = [['single', plannerSingle], ['centralized', plannerTriage], ['decentralized', plannerEntryPeer]] as const;

  async function edgesOf(agent: any) {
    const edges: string[] = [];
    const on = (e: any) => e.type === 'message' && edges.push(`${e.from}>${e.to}`);
    bus.on('event', on);
    emit({ type: 'reset', scope: 'all' });
    await agent.generate(ASK, { maxSteps: 40 });
    bus.off('event', on);
    return edges;
  }

  test('each specialist and peer only holds its own domain tools (+ peer tools)', async () => {
    const venueTools = Object.keys(await specialists.venue.listTools());
    assert.deepEqual(venueTools.sort(), ['assignRooms', 'checkAvailability', 'dropRoom', 'flagRisk', 'listRooms', 'quoteVenue']);
    const peerTools = Object.keys(await peers.venue.listTools()).sort();
    assert.deepEqual(peerTools, ['askPeer', 'assignRooms', 'checkAvailability', 'dropRoom', 'flagRisk', 'listRooms', 'postToBoard', 'quoteVenue', 'readBoard']);
    assert.equal(Object.keys(await plannerSingle.listTools()).length, 33, '21 read tools + 12 write tools');
    assert.equal(Object.keys(await plannerTriage.listTools()).length, 0, 'the hub has no domain tools');
  });

  test('step-free access is Accessibility data: the venue room list does not carry it', async () => {
    const list: any = (await specialists.venue.listTools()).listRooms;
    const out = JSON.stringify(await list.execute({}, {} as any));
    assert.ok(out.includes('Room C') && !/stepFree|inductionLoop/.test(out), out);
    assert.ok('checkRoomAccess' in (await specialists.access.listTools()));
  });

  test('each specialist and peer can only write its own domain', async () => {
    const allWrites = new Set(Object.values(WRITE_TOOLS).flat());
    for (const d of DOMAINS) {
      for (const agent of [specialists[d], peers[d]]) {
        const writes = Object.keys(await agent.listTools()).filter((t) => allWrites.has(t)).sort();
        assert.deepEqual(writes, [...WRITE_TOOLS[d]].sort(), `${agent.id} write tools`);
      }
    }
    // flagRisk is bound to the owner's domain: the marketing specialist cannot file a venue risk
    store.resetPlan();
    const flag: any = (await specialists.marketing.listTools()).flagRisk;
    await flag.execute({ text: 'Room C looks bad', domain: 'venue' } as any, {} as any);
    const risk = Object.values(store.getPlan('centralized').risks)[0];
    assert.equal(risk.domain, 'marketing');
    assert.equal(risk.by, 'marketing');
    // the single agent holds every write tool
    const single = Object.keys(await plannerSingle.listTools());
    for (const t of allWrites) assert.ok(single.includes(t), `single agent has ${t}`);
  });

  test('plan store: attribution, versions, per-mode plans, stale budget check, reset', () => {
    store.resetPlan();
    const venue = { mode: 'centralized', by: 'venue', domain: 'venue' } as const;
    store.assignRoom(venue, { room: 'Room C', track: 'Agents' });
    store.assignRoom(venue, { room: 'Hall A', keynote: true });
    assert.equal(store.getPlan('centralized').costs.venue?.eur, 9000 * 2 + 2800 * 2 + 4500 * 2);
    store.dropRoom(venue, 'Room C', 'stairs');
    store.assignRoom(venue, { room: 'Hall A', track: 'Agents' });
    const p = store.getPlan('centralized');
    assert.equal(p.rooms['Hall A'].track, 'Agents');
    assert.equal(p.rooms['Hall A'].by, 'venue');
    assert.equal(p.rooms['Hall A'].mode, 'centralized');
    assert.ok(p.rooms['Hall A'].at > 0);
    assert.equal(p.rooms['Hall A'].prev?.track, null, 'previous version kept');
    assert.equal(p.rooms['Room C'].dropped, true);
    assert.equal(p.costs.venue?.eur, 9000 * 2 + 4500 * 2);
    assert.equal(p.costs.venue?.prev?.eur, 9000 * 2 + 2800 * 2 + 4500 * 2);
    assert.equal(store.getPlan('single').changes.length, 0, 'other modes untouched');
    // accessibility can record the Foyer too
    store.markRooms({ mode: 'centralized', by: 'access', domain: 'access' }, [{ room: 'Foyer', stepFree: true, note: 'Step-free.' }]);
    assert.equal(store.getPlan('centralized').access['Foyer'].stepFree, true);

    const budget = { mode: 'centralized', by: 'budget', domain: 'budget' } as const;
    const travel = { mode: 'centralized', by: 'travel', domain: 'travel' } as const;
    store.recordBudgetCheck(budget, [{ domain: 'venue', eur: 27000 }, { domain: 'travel', eur: 20000, estimate: true }]);
    store.bookTravel(travel, ['SP-102'], 3); // what an approved list-price booking writes
    const stale = store.getPlan('centralized').stale;
    assert.deepEqual(stale, [{ domain: 'travel', checkedEur: 20000, currentEur: 1700, estimate: true }]);

    const events: any[] = [];
    const on = (e: any) => e.type === 'plan' && events.push(e);
    bus.on('event', on);
    store.flagRisk({ mode: 'single', by: 'single', domain: 'marketing' }, 'Tickets close to cap');
    for (const k of ['a', 'b', 'c']) store.flagRisk({ mode: 'single', by: 'single', domain: 'venue' }, `risk ${k}`, k);
    assert.ok('refused' in store.flagRisk({ mode: 'single', by: 'single', domain: 'venue' }, 'one too many', 'd'), 'max 3 risks per domain');
    assert.ok(!('refused' in store.flagRisk({ mode: 'single', by: 'single', domain: 'venue' }, 'risk a, updated', 'a')), 'updating by key is allowed');
    store.resetPlan('single');
    bus.off('event', on);
    assert.equal(events[0].change.by, 'single');
    assert.equal(events.at(-1).reset, true);
    assert.equal(Object.keys(store.getPlan('single').risks).length, 0);
    assert.ok(store.getPlan('centralized').changes.length > 0, 'resetting one mode keeps the others');
    store.resetPlan();
    assert.equal(store.getPlan('centralized').changes.length, 0);
  });

  /** A person approves the open booking of a mode (what the approval card does). */
  async function approveOpen(mode: string) {
    const open = store.getPlan(mode as any).approvals.filter((a: any) => a.status === 'pending');
    assert.equal(open.length, 1, `${mode}: one booking waits for approval`);
    const r = await store.approve(open[0].id, 'Test');
    assert.ok(r.ok, JSON.stringify(r));
    return open[0];
  }

  for (const [mode, agent] of MODES) {
    test(`${mode}: the mock run writes a complete, consistent plan`, async () => {
      emit({ type: 'reset', scope: 'all' });
      await (agent as any).generate(ASK, { maxSteps: 40 });
      assert.equal(Object.keys(store.getPlan(mode).travel).length, 0, 'travel is not booked before approval');
      await approveOpen(mode);
      const p = store.getPlan(mode);
      assert.ok(p.complete.all, JSON.stringify(p.complete));
      assert.equal(Object.keys(p.slots).length, 30);
      assert.equal(p.costs.venue?.eur, 38600);
      assert.equal(p.costs.catering?.eur, 69600);
      assert.equal(p.costs.travel?.eur, 18050);
      assert.equal(p.costs.access?.eur, 3800);
      assert.equal(p.access['Room C'].stepFree, false);
      assert.ok(!Object.values(p.rooms).some((r) => r.room === 'Room C' && !r.dropped), 'Room C is not used');
      assert.equal(p.rooms['Hall A'].keynote, true);
      assert.equal(p.rooms['Room B'].overflow, true);
      const writers = new Set([...Object.values(p.slots), ...Object.values(p.rooms), ...Object.values(p.travel)].map((e) => e.by));
      if (mode === 'single') assert.deepEqual([...writers], ['single']);
      else assert.deepEqual([...writers].sort(), ['program', 'travel', 'venue']);
      if (mode === 'decentralized') {
        assert.equal(p.budgetCheck?.totalEur, 144000);
        assert.deepEqual(p.stale, [{ domain: 'travel', checkedEur: 20000, currentEur: 18050, estimate: true }], 'stale read on the budget');
      } else {
        assert.equal(p.budgetCheck?.totalEur, 142050);
        assert.deepEqual(p.stale, []);
      }
      if (mode === 'centralized') assert.ok(p.changes.some((c) => c.key === 'Room C' && c.summary.includes('dropped')), 'venue dropped Room C after the relay');
    });
  }

  test('centralized: every message goes through the hub', async () => {
    const edges = await edgesOf(plannerTriage);
    assert.ok(edges.length > 0);
    assert.ok(edges.every((e) => e.startsWith('triage>')), edges.join(' '));
  });

  test('decentralized: peers talk to each other directly (venue asks access itself)', async () => {
    const edges = await edgesOf(plannerEntryPeer);
    assert.ok(edges.includes('venue>access'), edges.join(' '));
    assert.ok(edges.length <= MAX_MESSAGES, 'message budget holds');
  });

  test('every viz event carries the mode of the agent that caused it', async () => {
    for (const [mode, agent] of MODES) {
      for (const text of [ASK, REQUESTS.travel.text]) {
        const events: any[] = [];
        const on = (e: any) => events.push(e);
        emit({ type: 'reset', scope: 'all' });
        bus.on('event', on);
        await (agent as any).generate(text, { maxSteps: 40 });
        bus.off('event', on);
        const agentEvents = events.filter((e) => e.type !== 'reset');
        assert.ok(agentEvents.length > 10, `${mode}: events seen`);
        const wrong = agentEvents.filter((e) => e.mode !== mode).map((e) => `${e.type}:${e.agent ?? e.from ?? ''}:${e.mode}`);
        assert.deepEqual(wrong, [], `${mode}: every event is tagged ${mode}`);
        if (mode === 'single') assert.ok(!agentEvents.some((e) => e.type === 'message'), 'the single agent sends no agent messages');
      }
    }
  });

  test('passport data: only Travel can read it, and nothing it sends out carries a passport number', async () => {
    // tool boundary: readPassports exists only in Travel (and in the single agent, which holds every tool)
    const holders: string[] = [];
    for (const a of [plannerSingle, plannerTriage, ...Object.values(specialists), ...Object.values(peers)]) if ('readPassports' in (await (a as any).listTools())) holders.push(a.id);
    assert.deepEqual(holders.sort(), ['peer-travel', 'planner-single', 'spec-travel']);

    // measured boundary: whose model prompts held passport numbers during the travel request
    for (const [mode, agent] of MODES) {
      emit({ type: 'reset', scope: 'all' });
      store.resetPlan(mode, 'travel');
      const trace: string[] = [];
      const on = (e: any) => trace.push(JSON.stringify(e));
      bus.on('event', on);
      await (agent as any).generate(REQUESTS.travel.text, { maxSteps: 40 });
      bus.off('event', on);
      const expected = mode === 'single' ? ['single'] : ['travel'];
      assert.deepEqual(store.getPlan(mode).passportSeenBy, expected, `${mode}: who saw passport data`);
      assert.ok(!trace.some((t) => passports.some((p) => t.includes(p.passportNo))), `${mode}: the viz trace is redacted`);
      assert.ok(trace.some((t) => t.includes('[passport]')), `${mode}: the trace shows where passport data was redacted`);
    }

    // enforced boundary: if Travel's answer ever carries a passport number, the hub gets [passport] instead
    const leaked = `Booked. Passport ${passports[0].passportNo} checked.`;
    const r: any = await triageDelegation.onDelegationComplete({ primitiveId: 'travel', toolCallId: 'x', success: true, result: { text: leaked } });
    assert.equal(r.resultText, 'Booked. Passport [passport] checked.');
  });

  for (const [mode, agent] of MODES) {
    test(`${mode}: the second request (book speaker travel) writes a complete plan`, async () => {
      emit({ type: 'reset', scope: 'all' });
      store.resetPlan(mode, 'travel');
      await (agent as any).generate(REQUESTS.travel.text, { maxSteps: 40 });
      assert.equal(Object.keys(store.getPlan(mode).flights).length, 0, 'nothing booked before approval');
      await approveOpen(mode);
      const p = store.getPlan(mode);
      assert.equal(p.request, 'travel');
      assert.ok(p.complete.all, JSON.stringify(p.complete));
      assert.equal(Object.keys(p.flights).length, 14);
      assert.equal(Object.keys(p.hotels).length, 14);
      assert.ok(Object.values(p.flights).every((f) => f.arrives.startsWith('2027-05-10')), 'every speaker arrives by 10 May');
      assert.equal(p.costs.travel?.eur, 9650 + 14 * 3 * 200);
      assert.equal(p.budgetCheck?.lines.find((l) => l.domain === 'travel')?.eur, 18050);
      assert.deepEqual(p.stale, []);
      const visa = Object.values(p.visa);
      assert.deepEqual(visa.filter((v) => v.status === 'visa needed').map((v) => v.name), ['Ananya Rao']);
      assert.deepEqual(visa.filter((v) => v.status === 'passport too short').map((v) => v.name), ['James Whitaker']);
      assert.ok(!JSON.stringify(p).match(/PX\d{7}/), 'no passport number in the plan');
      const writers = new Set([...Object.values(p.flights), ...Object.values(p.hotels), ...visa].map((e) => e.by));
      assert.deepEqual([...writers], [mode === 'single' ? 'single' : 'travel']);
    });
  }

  // ---------- the stage requests: rooms and travelUs ----------
  const { entryPeerFor } = await import('../src/mastra/planner/agents');
  const { declineMessage } = await import('../src/mastra/planner/requests');
  /** Start a stage request the way the UI does: reset the plan of the mode with the request kind, then send the text. */
  async function runStage(mode: 'single' | 'centralized' | 'decentralized', kind: 'rooms' | 'travelUs', agent: any, text = REQUESTS[kind].text) {
    const events: any[] = [];
    const on = (e: any) => events.push(e);
    bus.on('event', on);
    await (agent as any).generate(text, { maxSteps: 40 });
    bus.off('event', on);
    return events;
  }
  const fresh = (mode: any, kind: any) => {
    emit({ type: 'reset', scope: 'all' });
    store.resetPlan(mode, kind);
  };

  test('no booking without an approval (all three setups), and only Travel reads passports', async () => {
    for (const [mode, agent] of MODES) {
      fresh(mode, 'travelUs');
      await runStage(mode, 'travelUs', agent);
      let p = store.getPlan(mode);
      assert.deepEqual([Object.keys(p.flights).length, Object.keys(p.hotels).length, p.costs.travel], [0, 0, undefined], `${mode}: nothing booked yet`);
      const open = p.approvals.filter((a) => a.status === 'pending');
      assert.equal(open.length, 1, `${mode}: one pending approval`);
      const a = open[0];
      assert.deepEqual(a.args.speakers.map((x) => x.name).sort(), ['Dana Whitfield', 'Kevin Brooks', 'Marcus Reed', 'Rachel Kim']);
      assert.deepEqual([a.args.flightsEur, a.args.hotelEur, a.args.hotel?.nights, a.args.totalEur], [4400, 2400, 3, 6800]);
      assert.equal(a.requestedBy, mode === 'single' ? 'single' : 'travel');
      assert.equal(a.mode, mode);
      assert.ok(a.evidence.visa.every((v) => v.status === 'visa-free'), 'evidence carries the visa status');
      assert.ok(p.complete.all, JSON.stringify(p.complete));
      assert.deepEqual(p.passportSeenBy, mode === 'single' ? ['single'] : ['travel'], `${mode}: who saw passport data`);
      assert.deepEqual(p.stale, [], 'the budget checked the proposed total');
      // a booking tool called directly also only proposes
      const tools: any = await (mode === 'single' ? plannerSingle : mode === 'centralized' ? specialists.travel : peers.travel).listTools();
      const r = await tools.bookFlights.execute({ offerIds: a.args.flights.map((f) => f.offerId) }, {} as any);
      assert.equal(r.status, 'waiting for approval');
      assert.equal(Object.keys(store.getPlan(mode).flights).length, 0);
    }
  });

  test('an approval only executes its own arguments; decline needs a reason and leads to a new proposal', async () => {
    fresh('centralized', 'travelUs');
    await runStage('centralized', 'travelUs', plannerTriage);
    const first = store.getPlan('centralized').approvals.at(-1)!;
    assert.ok(!store.decline(first.id, '  ').ok, 'a decline needs a reason');
    assert.ok(store.decline(first.id, 'Two hotel nights are enough.').ok);
    assert.ok(!(await store.approve(first.id)).ok, 'a declined proposal cannot be approved');
    await runStage('centralized', 'travelUs', plannerTriage, declineMessage('Two hotel nights are enough.'));
    const second = store.getPlan('centralized').approvals.at(-1)!;
    assert.notEqual(second.id, first.id);
    assert.deepEqual([second.status, second.args.hotel?.nights, second.args.totalEur], ['pending', 2, 6000]);
    // tampered arguments do not run
    const stored = store.getApproval(second.id)!;
    stored.args.hotel!.nights = 5;
    assert.ok(!(await store.approve(second.id)).ok, 'changed arguments are refused');
    stored.args.hotel!.nights = 2;
    const r = await store.approve(second.id, 'Melanie');
    assert.ok(r.ok);
    const p = store.getPlan('centralized');
    assert.ok(Object.values(p.hotels).every((h) => h.nights === 2) && Object.keys(p.hotels).length === 4, 'the stored 2 nights ran, not the declined 3');
    assert.equal(p.costs.travel?.eur, 6000);
    assert.equal(p.approvals.at(-1)!.decidedBy, 'Melanie');
    assert.ok(!(await store.approve(second.id)).ok, 'approve runs once');
    // reset invalidates open approvals
    fresh('single', 'travelUs');
    await runStage('single', 'travelUs', plannerSingle);
    const open = store.getPlan('single').approvals.at(-1)!;
    store.resetPlan();
    assert.equal(store.getApproval(open.id)!.status, 'invalidated');
    assert.ok(!(await store.approve(open.id)).ok);
  });

  test('each request routes only to its domains', async () => {
    for (const kind of ['rooms', 'travelUs'] as const) {
      const domains = [...REQUESTS[kind].domains].sort();
      fresh('centralized', kind);
      assert.deepEqual(Object.keys(await plannerTriage.listAgents()).sort(), domains, `${kind}: the hub only holds these specialists`);
      const ev = await runStage('centralized', kind, plannerTriage);
      const asked = [...new Set(ev.filter((e) => e.type === 'message').map((e) => e.to))].sort();
      assert.deepEqual(asked, domains, `${kind}: centralized asks only its domains`);
      fresh('decentralized', kind);
      assert.equal(plannerEntryPeer.id, entryPeerFor(kind).id);
      const ev2 = await runStage('decentralized', kind, plannerEntryPeer);
      assert.equal(ev2.find((e) => e.type === 'agent-start')?.agent, REQUESTS[kind].entry, `${kind}: enters at ${REQUESTS[kind].entry}`);
      const active = [...new Set(ev2.filter((e) => e.type === 'agent-start').map((e) => e.agent))].sort();
      assert.deepEqual(active, domains, `${kind}: decentralized involves only its domains`);
    }
    store.resetPlan();
    assert.equal(plannerEntryPeer.id, 'peer-program', 'the big requests enter at Program');
  });

  test('rooms: same result in every setup; the decentralized mock run produces the stale venue check', async () => {
    for (const [mode, agent] of MODES) {
      fresh(mode, 'rooms');
      await runStage(mode, 'rooms', agent);
      const p = store.getPlan(mode);
      assert.ok(p.complete.all, `${mode}: ${JSON.stringify(p.complete)}`);
      assert.equal(p.costs.venue?.eur, 38600);
      assert.equal(p.rooms['Hall A'].track, 'Agents');
      assert.equal(p.access['Room C'].stepFree, false);
      if (mode === 'decentralized') {
        assert.equal(p.budgetCheck?.lines.find((l) => l.domain === 'venue')?.eur, 44200);
        assert.equal(p.budgetCheck?.by, 'budget');
        assert.deepEqual(p.stale, [{ domain: 'venue', checkedEur: 44200, currentEur: 38600, estimate: false }]);
        const iCheck = p.changes.findIndex((c) => c.kind === 'budget');
        const iDrop = p.changes.findIndex((c) => c.key === 'Room C' && c.summary.includes('dropped'));
        assert.ok(iCheck >= 0 && iCheck < iDrop, 'budget checked before venue dropped Room C');
        assert.ok(p.costs.venue?.prev?.eur === 44200, 'venue line was €44,200 first');
      } else {
        assert.deepEqual(p.stale, []);
        assert.equal(p.budgetCheck?.lines.find((l) => l.domain === 'venue')?.eur, 38600);
      }
      if (mode === 'centralized') assert.ok(p.changes.some((c) => c.key === 'Room C' && c.summary.includes('dropped')), 'triage relayed the access finding to venue');
    }
  });

  // ---------- plans accumulate: a new request never clears the plan, only Reset does ----------
  test('a travel request after a rooms request keeps the rooms (every setup)', async () => {
    for (const [mode, agent] of MODES) {
      emit({ type: 'reset', scope: 'all' });
      store.startRun(mode, 'rooms');
      await runStage(mode, 'rooms', agent);
      store.startRun(mode, 'travelUs');
      await runStage(mode, 'travelUs', agent);
      const p = store.getPlan(mode);
      assert.equal(p.rooms['Hall A'].track, 'Agents', `${mode}: rooms are still there`);
      assert.equal(p.access['Room C'].stepFree, false, `${mode}: accessibility finding is still there`);
      assert.equal(p.costs.venue?.eur, 38600, `${mode}: venue line is still there`);
      assert.equal(p.approvals.filter((a) => a.status === 'pending').length, 1, `${mode}: the travel proposal waits`);
      assert.ok(p.complete.all, `${mode}: the travel run did all its parts ${JSON.stringify(p.parts)}`);
      // the travel check replaced the rooms check: the venue line it no longer has is not a stale read
      assert.deepEqual(p.budgetCheck?.lines.map((l) => l.domain), ['travel']);
      assert.deepEqual(p.stale, []);
    }
  });

  test('plan parts done: what this run wrote or confirmed; an earlier run counts as already in the plan', async () => {
    emit({ type: 'reset', scope: 'all' });
    store.startRun('single', 'rooms');
    await runStage('single', 'rooms', plannerSingle);
    assert.deepEqual(Object.values(store.getPlan('single').parts), ['done', 'done', 'done', 'done']);
    // a run that writes nothing: every part is only "already in the plan"
    store.startRun('single', 'rooms');
    let p = store.getPlan('single');
    assert.deepEqual(p.parts, { rooms: 'already', access: 'already', stepFree: 'already', budget: 'already' });
    assert.equal(p.complete.all, false);
    assert.equal(p.inPlan.all, true);
    // the same request again writes the same values: confirmed by this run, so it is measured fairly
    const before = p.changes.length;
    await runStage('single', 'rooms', plannerSingle);
    p = store.getPlan('single');
    assert.ok(p.complete.all, JSON.stringify(p.parts));
    assert.equal(p.changes.filter((c) => c.kind === 'room').length, store.getPlan('single').changes.slice(0, before).filter((c) => c.kind === 'room').length, 'unchanged rooms add no change entries');
    // a second budget check replaces the first one, the history shows both
    assert.equal(p.changes.filter((c) => c.kind === 'budget').length, 2);
    assert.equal(p.budgetCheck?.prev?.lines[0].eur, 38600);
  });

  test('decentralized: the stale venue check is still real after an earlier rooms run (the board belongs to the run)', async () => {
    emit({ type: 'reset', scope: 'all' });
    for (let k = 0; k < 2; k++) {
      const run = store.startRun('decentralized', 'rooms');
      const ev = await runStage('decentralized', 'rooms', plannerEntryPeer);
      const board = ev.filter((e) => e.type === 'tool-result' && e.tool === 'readBoard');
      assert.equal(board.length, 1, `run ${k + 1}: budget reads the board once`);
      assert.ok(!JSON.stringify(board[0].result).includes('38,600'), `run ${k + 1}: the board holds no venue cost of an earlier run`);
      const p = store.getPlan('decentralized');
      assert.equal(p.budgetCheck?.run, run.id, `run ${k + 1}: the check belongs to this run`);
      assert.deepEqual(p.stale, [{ domain: 'venue', checkedEur: 44200, currentEur: 38600, estimate: false }], `run ${k + 1}: stale read`);
      const mine = p.changes.filter((c) => c.at >= run.at);
      const iCheck = mine.findIndex((c) => c.kind === 'budget');
      const iDrop = mine.findIndex((c) => c.key === 'Room C' && c.summary.includes('dropped'));
      assert.ok(iCheck >= 0 && iCheck < iDrop, `run ${k + 1}: budget checked before venue dropped Room C`);
      assert.ok(p.complete.all, JSON.stringify(p.parts));
    }
  });

  // ---------- open requests: whatever a person types into the chat ----------
  test('open request: the router picks the entry peer, the triage gets every specialist, no fixed parts, a question writes nothing', async () => {
    const { routeRequest } = await import('../src/mastra/planner/agents');
    emit({ type: 'reset', scope: 'all' });
    const events: any[] = [];
    const on = (e: any) => events.push(e);
    bus.on('event', on);
    assert.equal(await routeRequest('Choose a caterer with vegan options'), 'catering');
    assert.equal(await routeRequest('How much buffer is left in the budget?'), 'budget');
    bus.off('event', on);
    const routerCalls = events.filter((e) => e.type === 'agent-start' && e.agent === 'router');
    assert.equal(routerCalls.length, 2, 'the router is one model call per request, drawn as its own node');
    assert.ok(routerCalls.every((e) => e.mode === 'decentralized'));

    store.startRun('centralized', 'open', 'Choose a caterer');
    assert.deepEqual(Object.keys(await plannerTriage.listAgents()).sort(), [...REQUESTS.conference.domains].sort(), 'an open request: the hub holds every specialist');
    store.startRun('decentralized', 'open', 'Choose a caterer');
    assert.equal(plannerEntryPeer.id, 'peer-program', 'before routing: the fallback');
    store.setRunEntry('decentralized', 'catering');
    assert.equal(plannerEntryPeer.id, 'peer-catering', 'after routing: the pick of the router');

    for (const [mode, agent] of MODES) {
      store.startRun(mode, 'open', 'What is the buffer left in the budget?');
      const before = store.getPlan(mode).changes.length;
      const r = await (agent as any).generate('What is the buffer left in the budget?', { maxSteps: 10 });
      const p = store.getPlan(mode);
      assert.equal(p.changes.length, before, `${mode}: a question writes nothing (mock)`);
      assert.deepEqual(p.parts, {}, `${mode}: an open request has no fixed parts`);
      assert.ok(p.complete.all);
      assert.match(String(r.text), /buffer €[\d,]+/, `${mode}: the mock answers with where the plan stands`);
    }
  });
});
