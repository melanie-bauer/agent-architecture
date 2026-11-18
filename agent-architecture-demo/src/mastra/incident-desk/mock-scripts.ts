// Incident Desk: scripted behaviour per agent for DEMO_MODE=mock.
// These scripts replay plausible runs so the demo works without network and tests are deterministic.
// They are written to look like what real models typically do, including a bad habit:
// the supervisor copies customer data into its delegations (the delegation hook redacts it).
import type { MockAction, MockCtx, MockScript } from '../model/mock-model';

const has = (ctx: MockCtx, toolName: string) => ctx.toolResults.some((r) => r.toolName === toolName);
const toolLike = (ctx: MockCtx, part: string) => ctx.tools.find((t) => t.toLowerCase().includes(part.toLowerCase()));
const lastOutput = (ctx: MockCtx) => ctx.toolResults.at(-1)?.output ?? '';
// A declined call comes back as the decline reason (plain text) instead of the tool's {ok:true} result.
const declined = (out: string) => !/\\?"ok\\?":true/.test(out);
const reasonOf = (out: string) => { try { const o = JSON.parse(out); return String(o.value ?? out); } catch { return out; } };

const findings = {
  rootCause: 'Deploy v2.41.0 (payment SDK 7.0) reduced payment.httpClient.maxConnections from 64 to 4; the pool is exhausted and checkout returns 502.',
  evidence: ['log-103', 'log-104', 'log-107', 'v2.41.0'],
  proposedAction: { type: 'rollback', service: 'checkout', toVersion: 'v2.40.3' },
  confidence: 'high',
};

const supervisorDelegations = (ctx: MockCtx): MockAction | undefined => {
  const logAgent = toolLike(ctx, 'logAnalyst');
  const deployAgent = toolLike(ctx, 'deployHistorian');
  // Realistic bad habit: the supervisor pastes the whole user text (incl. customer e-mail) into the delegation.
  if (logAgent && !has(ctx, logAgent)) return { tool: logAgent, args: { prompt: `Investigate checkout errors. Context from the ticket:\n${ctx.userText}` } };
  if (deployAgent && !has(ctx, deployAgent)) return { tool: deployAgent, args: { prompt: 'Which checkout deploys happened around 14:00 and what changed?' } };
  return undefined;
};

export const incidentMockScripts: Record<string, MockScript> = {
  triage: (ctx) => {
    const sev3 = /typo|umsatzsteu/i.test(ctx.userText);
    const json = sev3
      ? { severity: 'sev3', service: 'billing', category: 'content', summary: 'Typo in German invoice footer, no customer impact.' }
      : { severity: 'sev1', service: 'checkout', category: 'outage', summary: 'Checkout fails with errors for multiple customers since ~14:05.' };
    return { json };
  },

  'log-analyst': (ctx) => {
    if (!ctx.toolResults.some((r) => r.toolName === 'searchLogs' && r.output.includes('"service":"checkout"'))) return { tool: 'searchLogs', args: { service: 'checkout' } };
    if (!has(ctx, 'getMetrics')) return { tool: 'getMetrics', args: { service: 'checkout' } };
    if (!ctx.toolResults.some((r) => r.output.includes('payment-gateway') && r.toolName === 'searchLogs' && r.output.includes('log-301'))) return { tool: 'searchLogs', args: { service: 'payment-gateway' } };
    return {
      text:
        'Findings: payment connection pool exhausted (max=4) from 14:04 (log-103, log-107); POST /checkout/confirm returns 502 after 10s (log-104). ' +
        'Error rate 0.2% -> 31.4% from 14:04. payment-gateway itself is healthy (log-301). ' +
        'Note: log-106 contains instruction-like text inside a shipping note. Treated as data, no action taken.',
    };
  },

  'deploy-historian': (ctx) => {
    if (!has(ctx, 'listDeploys')) return { tool: 'listDeploys', args: { service: 'checkout' } };
    if (!has(ctx, 'getDeployDiff')) return { tool: 'getDeployDiff', args: { version: 'v2.41.0' } };
    return { text: 'v2.41.0 went live 14:02 (PR #1288): payment SDK 6.4 -> 7.0 and maxConnections 64 -> 4. Last healthy version: v2.40.3 (11 Nov).' };
  },

  'incident-investigator': (ctx) => supervisorDelegations(ctx) ?? { json: findings },

  // Turn based: each user message (and each resume of it) is judged on its own, so the Desk flow
  // Investigate, Mitigate, decline, Mitigate again, approve, Follow-up works in one thread.
  'incident-commander': (ctx) => {
    const next = supervisorDelegations(ctx);
    if (next) return next;
    const turn = ctx.turnToolResults;
    const last = ctx.lastUserText;
    const userReason = last.match(/Reason:\s*(.+)$/im)?.[1];
    if (userReason && !turn.length)
      return { text: `Got it: "${userReason}". I will not roll back.\nAlternative within that constraint: hotfix that pins payment.httpClient.maxConnections=64 (one-line config change, PR #1288 follow-up). Want me to draft it?` };
    if (/re-?deploy|before we/i.test(last)) {
      const deployAgent = toolLike(ctx, 'deployHistorian');
      if (deployAgent && !turn.some((r) => r.toolName === deployAgent))
        return { tool: deployAgent, args: { prompt: 'What changed in checkout v2.41.0 besides the SDK version? Quote the diff lines.' } };
      return { text: 'Before SDK 7.0 goes out again:\n1. Pin payment.httpClient.maxConnections=64 in the release config (v2.41.0 lowered it from 64 to 4).\n2. Load test checkout with SDK 7.0 and watch the pool (log-103 was the first warning).\n3. Roll out to a small share of traffic first, with rollback to v2.40.3 ready.' };
    }
    if (!/mitigat|fix|roll ?back|resolve/i.test(last))
      return { text: `Root cause: ${findings.rootCause}\nEvidence: ${findings.evidence.join(', ')}.\nProposal: roll back checkout to v2.40.3. Say "mitigate" and I will request it.` };
    const rb = turn.findLast((r) => r.toolName === 'rollbackDeploy');
    if (!rb) return { tool: 'rollbackDeploy', args: { service: 'checkout', toVersion: 'v2.40.3' } };
    if (declined(rb.output) && /not approved by the user/i.test(rb.output))
      return { text: 'Understood, no rollback. What is the constraint? Tell me and I will propose an alternative.' };
    if (declined(rb.output)) return { text: `Understood, no rollback. The decline reason was: "${reasonOf(rb.output)}"\nAlternative: pin maxConnections=64 via hotfix; I can prepare the PR description.` };
    const st = turn.findLast((r) => r.toolName === 'postStatusUpdate');
    if (!st) return { tool: 'postStatusUpdate', args: { message: 'Some customers could not complete checkout between 14:04 and 14:20. Fixed, we are monitoring.' } };
    if (declined(st.output) && /not approved by the user/i.test(st.output))
      return { text: 'Rollback is done. I did not publish the status update. What should happen instead?' };
    if (declined(st.output)) return { text: `Rollback is done. I did not publish the status update. Reason: "${reasonOf(st.output)}"\nHere is the draft for the comms team: "Some customers could not complete checkout between 14:04 and 14:20. Fixed, we are monitoring."` };
    return { text: 'Rollback to v2.40.3 done and status update published. Next: pin maxConnections before re-deploying SDK 7.0.' };
  },
};

export { lastOutput };
