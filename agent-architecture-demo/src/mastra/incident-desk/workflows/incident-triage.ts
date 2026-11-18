// The deterministic shell around the agents.
// Code decides the PATH. Agents are used only where the path is genuinely open (classification, investigation).
//
//   load-ticket ─► classify (small model, structured) ─┬─ sev3 ─► create-backlog-item           (no investigation)
//                                                      └─ sev1/2 ─► investigate (supervisor)
//                                                                     ─► approve-remediation (SUSPEND, human)
//                                                                     ─► execute-remediation  (plain code)
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { deploys, tickets } from '../data/incident-data';
import { redact } from '../agents/delegation';
import { TriageSchema } from '../agents/specialists';
import { FindingsSchema } from '../agents/supervisors';
import { recorder } from '../../model/recorder';

const TicketOut = z.object({ ticketId: z.string(), text: z.string() });
const Classified = TicketOut.extend({ triage: TriageSchema });
const Result = z.object({ ticketId: z.string(), outcome: z.string(), actionsExecuted: z.array(z.string()) });

const loadTicket = createStep({
  id: 'load-ticket',
  inputSchema: z.object({ ticketId: z.string() }),
  outputSchema: TicketOut,
  execute: async ({ inputData }) => {
    const t = tickets[inputData.ticketId];
    if (!t) throw new Error(`Unknown ticket ${inputData.ticketId}`);
    // PII is removed ONCE, at the entry of the system. Nothing downstream ever sees it.
    return { ticketId: t.id, text: redact(t.text) };
  },
});

const classify = createStep({
  id: 'classify',
  inputSchema: TicketOut,
  outputSchema: Classified,
  execute: async ({ inputData, mastra }) => {
    const res = await mastra.getAgent('triageAgent').generate(inputData.text, { structuredOutput: { schema: TriageSchema } });
    return { ...inputData, triage: res.object };
  },
});

const createBacklogItem = createStep({
  id: 'create-backlog-item',
  inputSchema: Classified,
  outputSchema: Result,
  execute: async ({ inputData }) => ({
    ticketId: inputData.ticketId,
    outcome: `Backlog item created (${inputData.triage.severity}): ${inputData.triage.summary}`,
    actionsExecuted: [],
  }),
});

const investigate = createStep({
  id: 'investigate',
  inputSchema: Classified,
  outputSchema: z.object({ ticketId: z.string(), findings: FindingsSchema }),
  execute: async ({ inputData, mastra }) => {
    const res = await mastra.getAgent('incidentInvestigator').generate(
      `Incident ${inputData.ticketId} (${inputData.triage.severity}, service ${inputData.triage.service}):\n${inputData.text}`,
      { structuredOutput: { schema: FindingsSchema }, memory: { thread: `wf-${inputData.ticketId}-${Date.now()}`, resource: 'incident-workflow' } },
    );
    return { ticketId: inputData.ticketId, findings: res.object };
  },
});

const approveRemediation = createStep({
  id: 'approve-remediation',
  inputSchema: z.object({ ticketId: z.string(), findings: FindingsSchema }),
  outputSchema: z.object({ ticketId: z.string(), findings: FindingsSchema, approved: z.boolean(), approver: z.string(), comment: z.string().optional() }),
  suspendSchema: z.object({ question: z.string(), proposal: FindingsSchema.shape.proposedAction, evidence: z.array(z.string()) }),
  // Demo: approver is a free string. Production: take it from the authenticated request, not from the payload.
  resumeSchema: z.object({ approved: z.boolean(), approver: z.string(), comment: z.string().optional() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.findings.proposedAction.type === 'none') return { ...inputData, approved: false, approver: 'workflow', comment: 'nothing to do' };
    if (!resumeData) {
      const a = inputData.findings.proposedAction;
      return await suspend({
        question: `Approve ${a.type} of ${a.service}${a.toVersion ? ` to ${a.toVersion}` : ''}?`,
        proposal: a,
        evidence: inputData.findings.evidence,
      });
    }
    return { ...inputData, ...resumeData };
  },
});

// LLM proposes, code disposes: the actual change is plain, reviewable code with an allow-list.
// Allowed rollback targets = versions that were really deployed for that service, except the current one.
export function allowedRollbackTargets(service: string): string[] {
  const history = deploys.filter((d) => d.service === service).sort((a, b) => b.at.localeCompare(a.at));
  return history.slice(1).map((d) => d.version);
}

const executeRemediation = createStep({
  id: 'execute-remediation',
  inputSchema: approveRemediation.outputSchema,
  outputSchema: Result,
  execute: async ({ inputData }) => {
    const a = inputData.findings.proposedAction;
    if (!inputData.approved) return { ticketId: inputData.ticketId, outcome: `Not executed (${inputData.approver}: ${inputData.comment ?? 'declined'}). Escalated to on-call.`, actionsExecuted: [] };
    if (a.type !== 'rollback' || !a.toVersion) return { ticketId: inputData.ticketId, outcome: `Action ${a.type} is not automatable, handed to on-call.`, actionsExecuted: [] };
    if (!allowedRollbackTargets(a.service).includes(a.toVersion))
      return { ticketId: inputData.ticketId, outcome: `Refused: ${a.service}@${a.toVersion} is not an allowed rollback target. Handed to on-call.`, actionsExecuted: [] };
    recorder.action({ tool: 'rollbackDeploy', args: { service: a.service, toVersion: a.toVersion }, gate: 'approved-by-human', at: new Date().toISOString() });
    return { ticketId: inputData.ticketId, outcome: `Rolled back ${a.service} to ${a.toVersion} (approved by ${inputData.approver}).`, actionsExecuted: [`rollback ${a.service} ${a.toVersion}`] };
  },
});

const incidentPath = createWorkflow({
  id: 'incident-path',
  inputSchema: Classified,
  outputSchema: Result,
})
  .then(investigate)
  .then(approveRemediation)
  .then(executeRemediation)
  .commit();

export const incidentTriage = createWorkflow({
  id: 'incident-triage',
  description: 'Ticket -> classify -> (sev3: backlog) | (sev1/2: investigate -> human approval -> execute)',
  inputSchema: z.object({ ticketId: z.string() }),
  outputSchema: z.object({ 'create-backlog-item': Result.optional(), 'incident-path': Result.optional() }),
})
  .then(loadTicket)
  .then(classify)
  .branch([
    [async ({ inputData }) => inputData.triage.severity === 'sev3', createBacklogItem],
    [async ({ inputData }) => inputData.triage.severity !== 'sev3', incidentPath],
  ])
  .commit();
