// Two supervisors over the same specialists:
//   incidentInvestigator -> used INSIDE the workflow. No write tools at all. Returns structured findings.
//   incidentCommander    -> used in the chat UI (AG-UI). Write tools exist, but every one needs a human.
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { model } from '../../model/models';
import { buildTools, pick } from '../tools';
import { demoMode } from '../../model/models';
import { answerJudged, customerDataKept, rootCauseFound } from '../scorers';
import { delegationPolicy } from './delegation';
import { deployHistorian, logAnalyst } from './specialists';

export const FindingsSchema = z.object({
  rootCause: z.string(),
  evidence: z.array(z.string()).describe('log ids (log-123) or versions (v1.2.3) that support the root cause'),
  proposedAction: z.object({
    type: z.enum(['rollback', 'restart', 'none']),
    service: z.string(),
    toVersion: z.string().optional(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type Findings = z.infer<typeof FindingsSchema>;

const SUPERVISOR_RULES = `Available specialists:
- logAnalyst: logs + metrics of a service, returns findings with log ids.
- deployHistorian: deploy history + diffs, returns versions and changed lines.
Strategy: ask logAnalyst what happened and when, ask deployHistorian what changed at that time,
then correlate. Do not delegate the same question twice. Never pass customer personal data to specialists.
Every claim needs evidence ids.`;

export const incidentInvestigator = new Agent({
  id: 'incident-investigator',
  name: 'desk-Incident Investigator',
  description: 'Finds the root cause of an incident and proposes ONE remediation. Cannot change anything.',
  instructions: `You investigate production incidents for Parcelly.\n${SUPERVISOR_RULES}\nYou only PROPOSE an action. A human and the workflow decide.`,
  model: model('incident-investigator', 'large'),
  agents: { logAnalyst, deployHistorian },
  memory: new Memory(),
  // behaviour, sampled on every run: did it find the real cause? (results in Studio, Scorers)
  scorers: { rootCauseFound: { scorer: rootCauseFound, sampling: { type: 'ratio', rate: 1 } } },
  defaultOptions: { maxSteps: 6, delegation: delegationPolicy },
});

const gated = buildTools();

export const incidentCommander = new Agent({
  id: 'incident-commander',
  name: 'desk-Incident Commander',
  description: 'Chat-facing incident lead. Investigates via specialists, mitigates only with human approval.',
  instructions: `You are the incident commander for Parcelly, talking to the on-call engineer.\n${SUPERVISOR_RULES}
You may request rollbackDeploy, restartService or postStatusUpdate. A human approves or declines each call.
If a call is declined, respect the reason and propose an alternative instead of retrying.
Runbook RB-07: never restart checkout because of payment problems.`,
  model: model('incident-commander', 'large'),
  agents: { logAnalyst, deployHistorian },
  tools: { ...pick(gated, 'rollbackDeploy', 'restartService', 'postStatusUpdate', 'searchRunbooks') },
  memory: new Memory(),
  // behaviour, sampled on every run: does the chat answer repeat the customer's data? (results in Studio, Scorers)
  scorers: {
    customerDataKept: { scorer: customerDataKept, sampling: { type: 'ratio', rate: 1 } },
    // LLM as judge: live only, the scripted mock model cannot judge
    answerJudged: { scorer: answerJudged, sampling: demoMode() === 'live' ? { type: 'ratio', rate: 1 } : { type: 'none' } },
  },
  defaultOptions: { maxSteps: 8, delegation: delegationPolicy },
});
