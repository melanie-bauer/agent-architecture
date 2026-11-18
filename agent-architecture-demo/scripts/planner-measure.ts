// Runs planner requests against the running server and measures them from the viz events (/planner/events).
// It needs the server (docker compose up -d), because the network modes talk A2A over HTTP.
// Whether the server runs live or mock is the server's choice (PLANNER_MODE); the table says which.
//
//   npm run planner:measure                       the stage set: rooms and travelUs, each in all three setups
//   npx tsx scripts/planner-measure.ts --mode=all --request=conference --label=before
//   npx tsx scripts/planner-measure.ts --mode=centralized --request=travelUs
//
// Appends one record per run to recordings/planner-timings.json and prints where the time went:
// wall time, model calls on the critical path and in total, tokens, agent messages, tool and outside system seconds, plan completeness.
// travelUs stops at the approval card (nobody approves here); "card" is the time until the card appeared.
import { MastraClient } from '@mastra/client-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { REQUEST_KINDS, REQUESTS, type RequestKind } from '../src/mastra/planner/requests';

const BASE = process.env.PLANNER_URL ?? 'http://localhost:4111';
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const modes = arg('mode', 'all') === 'all' ? ['single', 'centralized', 'decentralized'] : [arg('mode', 'single')];
const requestArg = arg('request', 'stage');
const requests = (requestArg === 'stage' ? ['rooms', 'travelUs'] : [requestArg]) as RequestKind[];
for (const r of requests) if (!REQUEST_KINDS.includes(r)) throw new Error(`--request must be stage or one of ${REQUEST_KINDS.join(', ')}`);
const label = arg('label', 'run');
const out = arg('out', 'recordings/planner-timings.json');
/** Where a request enters: the decentralized entry peer depends on the request. */
const entryOf = (mode: string, request: RequestKind) => (mode === 'single' ? 'planner-single' : mode === 'centralized' ? 'planner-triage' : `peer-${REQUESTS[request].entry}`);
/** Live targets from the run of show, in seconds. travelUs counts until the approval card. */
const TARGET: Partial<Record<RequestKind, Record<string, number>>> = { rooms: { single: 25, centralized: 60, decentralized: 50 }, travelUs: { single: 45, centralized: 45, decentralized: 45 } };

type Ev = Record<string, any> & { t: number; type: string; mode?: string };

/** Model calls on the critical path: the longest chain of model calls that ran one after another, not at the same time. */
function criticalPath(calls: { start: number; end: number }[]) {
  const sorted = [...calls].sort((a, b) => a.end - b.end);
  const best: number[] = [];
  sorted.forEach((c, i) => {
    best[i] = 1 + Math.max(0, ...sorted.slice(0, i).map((d, j) => (d.end <= c.start ? best[j] : 0)));
  });
  return Math.max(0, ...best);
}

async function listen(onEvent: (e: Ev) => void, signal: AbortSignal) {
  const res = await fetch(`${BASE}/planner/events`, { signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) onEvent(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
}

async function runOne(mode: string, request: RequestKind) {
  const info = await (await fetch(`${BASE}/planner/info`)).json();
  // every measurement starts from an empty plan: Reset once (plans accumulate otherwise), then start the run
  const post = (url: string, body: object) => fetch(`${BASE}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/planner/reset', { scope: 'all' });
  await post('/planner/run', { mode, request });
  const events: Ev[] = [];
  const ctl = new AbortController();
  await listen((e) => (e.mode === mode || e.type === 'reset') && events.push(e), ctl.signal);
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  let error: string | undefined;
  let text = '';
  try {
    // stream, not generate: the server cuts plain requests off after 180 s, and the client must not retry (that would start a second run)
    const res: any = await new MastraClient({ baseUrl: BASE, retries: 0 }).getAgent(entryOf(mode, request)).stream(REQUESTS[request].text, { maxSteps: 40 } as any);
    await res.processDataStream({
      onChunk: async (c: any) => {
        if (c.type === 'text-delta') text += c.payload?.text ?? '';
        if (c.type === 'error') error = String(c.payload?.error?.message ?? c.payload?.error ?? 'stream error').slice(0, 300);
      },
    });
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 300);
  }
  const wallS = (Date.now() - t0) / 1000;
  await new Promise((r) => setTimeout(r, 500));
  ctl.abort();
  const plan = await (await fetch(`${BASE}/planner/plan?mode=${mode}`)).json();

  const ends = events.filter((e) => e.type === 'agent-end');
  const starts = new Map(events.filter((e) => e.type === 'agent-start').map((e) => [e.call, e.t]));
  const card = events.find((e) => e.type === 'approval' && e.status === 'pending');
  const perAgent: Record<string, { calls: number; modelS: number; tokens: number }> = {};
  for (const e of ends) {
    const a = (perAgent[e.agent] ??= { calls: 0, modelS: 0, tokens: 0 });
    a.calls++;
    a.modelS += (e.ms ?? 0) / 1000;
    a.tokens += e.tokens ?? 0;
  }
  const results = events.filter((e) => e.type === 'tool-result');
  const complete = plan.complete ?? {};
  const checks = Object.entries(complete).filter(([k]) => k !== 'all');
  const rec = {
    label,
    request,
    mode,
    at: new Date().toISOString(),
    planner: info.mode as string,
    models: info.models,
    reasoningEffort: info.reasoningEffort ?? 'default',
    wallS: Math.round(wallS * 10) / 10,
    cardS: card ? Math.round((card.t - t0) / 100) / 10 : null,
    llmCalls: ends.length,
    criticalCalls: criticalPath(ends.map((e) => ({ start: starts.get(e.call) ?? e.t - (e.ms ?? 0), end: e.t }))),
    tokens: ends.reduce((s, e) => s + (e.tokens ?? 0), 0),
    modelS: Math.round(ends.reduce((s, e) => s + (e.ms ?? 0), 0) / 100) / 10,
    toolCalls: events.filter((e) => e.type === 'tool').length,
    toolS: Math.round(results.reduce((s, e) => s + (e.ms ?? 0), 0) / 100) / 10,
    systemS: Math.round(results.filter((e) => e.system).reduce((s, e) => s + (e.ms ?? 0), 0) / 100) / 10,
    agentMessages: events.filter((e) => e.type === 'message').length,
    complete: `${checks.filter(([, v]) => v).length} of ${checks.length}`,
    completeAll: !!complete.all,
    missing: checks.filter(([, v]) => !v).map(([k]) => k),
    stale: plan.stale ?? [],
    approval: plan.approvals?.at(-1) ? { status: plan.approvals.at(-1).status, totalEur: plan.approvals.at(-1).args.totalEur, nights: plan.approvals.at(-1).args.hotel?.nights } : null,
    passportSeenBy: plan.passportSeenBy ?? [],
    perAgent: Object.fromEntries(Object.entries(perAgent).map(([k, v]) => [k, { calls: v.calls, modelS: Math.round(v.modelS * 10) / 10, tokens: v.tokens }])),
    error,
    answer: text.slice(0, 400),
  };
  console.log(
    `\n== ${label} ${request} ${mode}: ${rec.wallS}s wall${rec.cardS != null ? ` (approval card after ${rec.cardS}s)` : ''}, ${rec.criticalCalls} of ${rec.llmCalls} LLM calls on the critical path (${rec.modelS}s model time), ${rec.tokens} tokens, ${rec.agentMessages} agent messages, ${rec.toolCalls} tool calls (${rec.toolS}s, outside systems ${rec.systemS}s), plan ${rec.complete}${rec.missing.length ? ` missing ${rec.missing.join(',')}` : ''}${error ? ` ERROR ${error}` : ''}`,
  );
  for (const [a, v] of Object.entries(rec.perAgent).sort((x, y) => y[1].modelS - x[1].modelS)) console.log(`   ${a.padEnd(10)} ${String(v.calls).padStart(3)} calls  ${String(v.modelS).padStart(6)}s model  ${v.tokens} tokens`);
  const all = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
  all.push(rec);
  writeFileSync(out, JSON.stringify(all, null, 2) + '\n');
  return rec;
}

const recs: Awaited<ReturnType<typeof runOne>>[] = [];
for (const r of requests) for (const m of modes) recs.push(await runOne(m, r));

// one row per run: one run each, on this machine, not a benchmark
const rows = recs.map((r) => {
  const target = TARGET[r.request]?.[r.mode];
  const measured = r.request === 'travelUs' ? r.cardS : r.wallS;
  const verdict =
    target == null ? '' : measured == null ? 'no card' : r.planner !== 'live' ? `(live target ${target}s)` : measured <= target ? `ok (${target}s)` : `missed by ${Math.round((measured - target) * 10) / 10}s (${target}s)`;
  return [r.request, r.mode, r.planner, `${r.wallS}s`, r.cardS == null ? '' : `${r.cardS}s`, String(r.criticalCalls), String(r.llmCalls), String(r.tokens), String(r.agentMessages), r.complete, verdict];
});
const head = ['request', 'setup', 'model', 'wall', 'card', 'critical calls', 'calls', 'tokens', 'agent msgs', 'plan', 'target'];
const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(width[i])).join('  ');
console.log(`\n${line(head)}\n${width.map((w) => '-'.repeat(w)).join('  ')}\n${rows.map(line).join('\n')}\n`);
process.exit(0);
