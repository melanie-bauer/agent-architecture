// HTTP surface of the planner example:
//   /copilotkit          CopilotKit runtime (AG-UI) – agents "single" | "centralized" | "decentralized"
//   /planner             the React UI (ui-planner/dist)
//   /planner/events      SSE stream of the visualisation bus
//   /planner/run         POST {mode, request, question?}: a new request starts in one setup (request: rooms | travelUs | conference | travel);
//                        with question: a typed follow-up to that request (no new request, the agents answer it).
//                        Clears nothing in the plan (plans accumulate); a new run id, the peers' board and message budget start fresh
//   /planner/reset       POST {scope}: scope "all" (default) clears every plan, the board and the network budgets (the Reset button);
//                        "run" is the same as /planner/run (kept for older clients); "network" changes nothing on the server
//   /planner/plan        GET ?mode=single|centralized|decentralized, the plan the agents wrote (all modes without ?mode)
//   /planner/data/:kind  GET the fixed base data (event, submissions, speakers, rooms, caterers, dietary, budget, tickets, sponsors)
//   /planner/approvals/:id/approve   POST {by?}: a person approves; the server books exactly the stored arguments (no model call)
//   /planner/approvals/:id/decline   POST {reason}: a person declines with a required reason; the UI then starts a new run
import { MastraAgent } from '@ag-ui/mastra';
import { registerCopilotKit } from '@ag-ui/mastra/copilotkit';
import { registerApiRoute } from '@mastra/core/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { plannerEntryPeer, plannerSingle, plannerTriage } from './agents';
import { transport } from './peers';
import { MODEL_IDS, plannerMode, plannerReasoningEffort } from '../model/models';
import { bus, emit } from './viz';
import * as data from './data';
import { HOTEL_OFFERS, SYSTEM_LATENCY_MS, SYSTEMS } from './external';
import { approve, decline, getPlan, PLAN_MODES, resetPlan, startRun, type PlanMode } from './plan-store';
import { declineMessage, REQUEST_KINDS, type RequestKind } from './requests';

const BASE_DATA: Record<string, () => unknown> = {
  event: () => data.EVENT,
  submissions: () => data.submissions,
  speakers: () => data.speakers,
  rooms: () => data.rooms.map((r) => ({ ...r, availability: data.availability[r.id] ?? null })),
  caterers: () => data.caterers,
  dietary: () => data.dietary,
  budget: () => ({ ...data.ledger, committedEur: data.ledger.committed.reduce((s, c) => s + c.eur, 0) }),
  tickets: () => data.tickets,
  sponsors: () => data.sponsors,
  schedule: () => ({ slots: data.SLOTS, keynotes: data.KEYNOTES, tracks: data.EVENT.tracks }),
  travel: () => ({ hotelEurPerNight: data.HOTEL_EUR_PER_NIGHT, flightEur: data.FLIGHT_EUR, local: data.LOCAL }),
  captioning: () => data.captioning,
  // second request: the fake outside systems (names and latency only; passports are NOT served, only Travel reads them)
  systems: () => ({ systems: SYSTEMS, latencyMs: SYSTEM_LATENCY_MS, hotelOffers: HOTEL_OFFERS, arriveBy: data.ARRIVE_BY, visaRules: data.VISA_RULES }),
};

export function plannerRoutes(root: string) {
  const dist = path.join(root, 'ui-planner', 'dist');
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
  const serve = async (rel: string) => {
    const file = path.join(dist, rel);
    if (!file.startsWith(dist)) return new Response('no', { status: 403 });
    try {
      // index.html must never be cached: it names the hashed bundle of the current build
      const cache = rel.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
      return new Response(await readFile(file), { headers: { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache } });
    } catch {
      return new Response('UI not built. Run: npm run build:planner', { status: 404 });
    }
  };

  return [
    registerCopilotKit({
      path: '/copilotkit',
      resourceId: 'planner-user',
      agents: {
        single: new MastraAgent({ agent: plannerSingle as any, resourceId: 'planner-user' }),
        centralized: new MastraAgent({ agent: plannerTriage as any, resourceId: 'planner-user', subagentVisibility: 'hidden' }),
        decentralized: new MastraAgent({ agent: plannerEntryPeer as any, resourceId: 'planner-user' }),
      } as any,
    }),
    registerApiRoute('/planner', { method: 'GET', handler: async () => serve('index.html') }),
    registerApiRoute('/planner/assets/:file', { method: 'GET', handler: async (c) => serve(path.join('assets', c.req.param('file'))) }),
    registerApiRoute('/planner/info', { method: 'GET', handler: async (c) => (c.header('Cache-Control', 'no-store'), c.json({ transport: transport(), mode: plannerMode(), models: MODEL_IDS, reasoningEffort: plannerReasoningEffort() })) }),
    registerApiRoute('/planner/run', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        if (!PLAN_MODES.includes(body?.mode)) return c.json({ error: `mode must be one of ${PLAN_MODES.join(', ')}` }, 400);
        const request: RequestKind = REQUEST_KINDS.includes(body?.request) ? body.request : 'conference';
        const question = typeof body?.question === 'string' && body.question.trim() ? body.question.trim().slice(0, 1000) : undefined;
        return c.json({ ok: true, run: startRun(body.mode as PlanMode, request, question) });
      },
    }),
    registerApiRoute('/planner/reset', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const scope: 'all' | 'run' | 'network' = body?.scope === 'run' || body?.scope === 'network' ? body.scope : 'all';
        const mode = PLAN_MODES.includes(body?.mode) ? (body.mode as PlanMode) : undefined;
        const request: RequestKind = REQUEST_KINDS.includes(body?.request) ? body.request : 'conference';
        // a new request never clears the plan: "run" only starts a run (it emits its own event)
        if (scope === 'run' && mode) return c.json({ ok: true, scope, request, run: startRun(mode, request) });
        if (scope === 'all') resetPlan();
        emit({ type: 'reset', mode: body?.mode, scope, request });
        return c.json({ ok: true, scope, request });
      },
    }),
    registerApiRoute('/planner/approvals/:id/approve', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        // only the id counts: arguments in the body are ignored, the stored ones run
        const r = await approve(c.req.param('id'), typeof body?.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 60) : 'Event team');
        return r.ok ? c.json({ ok: true, approval: r.approval }) : c.json({ ok: false, error: r.error }, 409);
      },
    }),
    registerApiRoute('/planner/approvals/:id/decline', {
      method: 'POST',
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 300) : '';
        const r = decline(c.req.param('id'), reason, typeof body?.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 60) : 'Event team');
        return r.ok ? c.json({ ok: true, approval: r.approval, message: declineMessage(reason) }) : c.json({ ok: false, error: r.error }, r.error === 'A reason is required' ? 400 : 409);
      },
    }),
    registerApiRoute('/planner/plan', {
      method: 'GET',
      handler: async (c) => {
        const mode = c.req.query('mode') as PlanMode | undefined;
        c.header('Cache-Control', 'no-store');
        if (mode && !PLAN_MODES.includes(mode)) return c.json({ error: `mode must be one of ${PLAN_MODES.join(', ')}` }, 400);
        return c.json(mode ? getPlan(mode) : Object.fromEntries(PLAN_MODES.map((m) => [m, getPlan(m)])));
      },
    }),
    registerApiRoute('/planner/data/:kind', {
      method: 'GET',
      handler: async (c) => {
        const get = BASE_DATA[c.req.param('kind')];
        return get ? c.json(get()) : c.json({ error: `unknown data set. Known: ${Object.keys(BASE_DATA).join(', ')}` }, 404);
      },
    }),
    registerApiRoute('/planner/events', {
      method: 'GET',
      handler: async (c) => {
        const enc = new TextEncoder();
        let listener: (e: unknown) => void;
        const stream = new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(enc.encode(': connected\n\n'));
            listener = (e) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
            bus.on('event', listener);
            c.req.raw.signal.addEventListener('abort', () => bus.off('event', listener));
          },
          cancel() {
            bus.off('event', listener);
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
      },
    }),
  ];
}
