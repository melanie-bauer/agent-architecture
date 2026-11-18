// Workflow endpoint for the Desk's Workflow tab: POST /desk/workflow  (response = SSE stream of AG-UI events)
//   { action: 'start', ticketId }                  starts incidentTriage
//   { action: 'resume', runId, approved, comment } resumes the paused approval step
// The Mastra workflow stream (workflow-step-start / -result / -suspended / workflow-finish) is translated
// into AG-UI events, so the same timeline can show both tabs. Nothing about the workflow changes here.
import { EventEncoder } from '@ag-ui/encoder';
import { registerApiRoute } from '@mastra/core/server';
import { tickets } from '../data/incident-data';
import { withDeskTap } from './desk-tap';

/** Names of the extra events the Workflow tab uses. */
export const WF_EVENT = {
  ticket: 'desk.ticket', // the ticket as it arrived, before load-ticket removes customer data
  stepResult: 'desk.stepResult', // a step's output
  stepSuspended: 'desk.stepSuspended', // the approval step paused
  delegation: 'desk.delegation', // the investigator asks a specialist / the answer comes back
  specialistInput: 'desk.specialistInput', // what the specialist's model received (same as the chat tab)
} as const;

const APPROVE_STEP = ['incident-path', 'approve-remediation'];
// Demo: the approver is fixed on the server. Production: take it from the authenticated request.
const APPROVER = 'on-call engineer (Desk)';

export type WorkflowRequest =
  | { action: 'start'; ticketId: string }
  | { action: 'resume'; runId: string; approved: boolean; comment?: string };

/** Runs one request against the workflow and passes AG-UI events to `send`. Resolves when the stream ends. */
export async function runWorkflowAgui(mastra: any, req: WorkflowRequest, send: (event: any) => void): Promise<void> {
  const wf = mastra.getWorkflow('incidentTriage');
  const threadId = 'incident-workflow';
  let runId = req.action === 'resume' ? req.runId : '';
  const custom = (name: string, value: unknown) => send({ type: 'CUSTOM', name, value });
  const seen = new Set<string>();

  try {
    if (req.action === 'start' && !tickets[req.ticketId]) throw new Error(`Unknown ticket ${req.ticketId}`);
    const run = req.action === 'resume' ? await wf.createRun({ runId: req.runId }) : await wf.createRun();
    runId = run.runId;
    send({ type: 'RUN_STARTED', threadId, runId });
    if (req.action === 'start') custom(WF_EVENT.ticket, { ticketId: req.ticketId, raw: tickets[req.ticketId].text });

    await withDeskTap(
      {
        input: (v) => {
          const key = `${v.agent}\n${v.received}`; // one event per request text, not one per model step
          if (seen.has(key)) return;
          seen.add(key);
          custom(WF_EVENT.specialistInput, v);
        },
        delegation: (d) => custom(WF_EVENT.delegation, d),
      },
      async () => {
        const out =
          req.action === 'start'
            ? run.stream({ inputData: { ticketId: req.ticketId } })
            : await run.resumeStream({ resumeData: { approved: req.approved, approver: APPROVER, comment: req.comment || undefined }, step: APPROVE_STEP });
        for await (const c of out as any) {
          const p = c.payload ?? {};
          if (c.type === 'workflow-step-start') send({ type: 'STEP_STARTED', stepName: p.stepName });
          else if (c.type === 'workflow-step-result') {
            custom(WF_EVENT.stepResult, { step: p.stepName, status: p.status, output: p.output });
            send({ type: 'STEP_FINISHED', stepName: p.stepName });
          } else if (c.type === 'workflow-step-suspended' && p.stepName?.includes('.')) {
            custom(WF_EVENT.stepSuspended, { step: p.stepName, payload: p.suspendPayload });
          }
        }
        const res: any = await out.result;
        if (res.status === 'suspended') {
          const sp = res.suspendPayload?.['incident-path'] ?? {};
          send({
            type: 'RUN_FINISHED',
            threadId,
            runId,
            outcome: {
              type: 'interrupt',
              interrupts: [{ id: `${runId}:approve-remediation`, reason: 'approval', message: sp.question, metadata: { workflow: { runId, step: 'approve-remediation', ...sp } } }],
            },
          });
        } else if (res.status === 'success') {
          send({ type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' }, result: res.result });
        } else {
          send({ type: 'RUN_ERROR', message: String(res.error?.message ?? res.error ?? `workflow ${res.status}`) });
        }
      },
    );
  } catch (err: any) {
    send({ type: 'RUN_ERROR', message: String(err?.message ?? err) });
  }
}

const parseRequest = (b: any): WorkflowRequest | undefined => {
  if (b?.action === 'start' && typeof b.ticketId === 'string') return { action: 'start', ticketId: b.ticketId };
  if (b?.action === 'resume' && typeof b.runId === 'string' && typeof b.approved === 'boolean')
    return { action: 'resume', runId: b.runId, approved: b.approved, comment: typeof b.comment === 'string' ? b.comment.slice(0, 500) : undefined };
  return undefined;
};

export const workflowRoute = registerApiRoute('/desk/workflow', {
  method: 'POST',
  handler: async (c) => {
    const req = parseRequest(await c.req.json().catch(() => undefined));
    if (!req) return c.json({ error: 'expected { action: "start", ticketId } or { action: "resume", runId, approved, comment? }' }, 400);
    const mastra = c.get('mastra');
    const encoder = new EventEncoder({ accept: c.req.header('accept') });
    const body = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        await runWorkflowAgui(mastra, req, (event) => controller.enqueue(enc.encode(encoder.encode(event))));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': encoder.getContentType(), 'Cache-Control': 'no-cache' } });
  },
});
