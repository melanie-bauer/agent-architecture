// AG-UI endpoint: POST /agui/:agentId  (body = AG-UI RunAgentInput, response = SSE stream of AG-UI events)
// This is the whole "protocol layer" between agent backend and UI. ~30 lines.
import { MastraAgent } from '@ag-ui/mastra';
import { EventEncoder } from '@ag-ui/encoder';
import { registerApiRoute } from '@mastra/core/server';
import { withSpecialistTap } from './desk-tap';

const EXPOSED = new Set(['incidentCommander']); // only agents you list here are reachable from a browser

/** Name of the extra event the Desk UI uses to show what a specialist received after redaction. */
export const SPECIALIST_INPUT_EVENT = 'desk.specialistInput';

/**
 * Runs one AG-UI request and passes every event to `send`.
 * Besides the bridge's own events it adds one AG-UI CUSTOM event per specialist request:
 * what the specialist's model really received (observed in the model wrapper, see desk-tap.ts).
 */
export function runAgui(agent: { run(input: any): { subscribe(o: any): { unsubscribe(): void } } }, input: any, send: (event: any) => void, done: () => void) {
  const seen = new Set<string>();
  let open = true;
  return withSpecialistTap(
    (e) => {
      const key = `${e.agent}\n${e.received}`;
      if (!open || seen.has(key)) return; // one event per request text, not one per model step
      seen.add(key);
      send({ type: 'CUSTOM', name: SPECIALIST_INPUT_EVENT, value: e });
    },
    () =>
      agent.run(input).subscribe({
        next: (event: any) => send(event),
        error: (err: any) => {
          send({ type: 'RUN_ERROR', message: String(err?.message ?? err) });
          open = false;
          done();
        },
        complete: () => {
          open = false;
          done();
        },
      }),
  );
}

export const aguiRoute = registerApiRoute('/agui/:agentId', {
  method: 'POST',
  handler: async (c) => {
    const agentId = c.req.param('agentId');
    if (!EXPOSED.has(agentId)) return c.json({ error: 'agent not exposed' }, 404);
    const input = await c.req.json();
    const agent = new MastraAgent({
      agent: c.get('mastra').getAgent(agentId as any),
      resourceId: 'on-call-engineer',
      subagentVisibility: 'attributed', // stream SUBAGENT_STARTED/FINISHED + their tool calls to the UI
    });
    const encoder = new EventEncoder({ accept: c.req.header('accept') });
    const body = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const sub = runAgui(agent, input, (event) => controller.enqueue(enc.encode(encoder.encode(event))), () => controller.close());
        c.req.raw.signal.addEventListener('abort', () => sub.unsubscribe());
      },
    });
    return new Response(body, { headers: { 'Content-Type': encoder.getContentType(), 'Cache-Control': 'no-cache' } });
  },
});
