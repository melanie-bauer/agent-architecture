// The handoff boundary between supervisor and subagents.
// This is where you decide WHAT a specialist gets to see and HOW MUCH it may spend.
import { reportDelegation } from '../server/desk-tap';

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const CARD = /card ending \d{4}/gi;
const NAME = /(Customer|customer)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g; // demo-grade; use a real PII detector in production
export const redact = (s: string) => s.replace(EMAIL, '[email]').replace(CARD, '[card]').replace(NAME, '$1 [name]');
const redactDeep = <T>(v: T): T => JSON.parse(redact(JSON.stringify(v)));

export const MAX_DELEGATIONS = 4;

// Note: ctx.iteration is NOT a delegation counter (it is derived from the parent's messages).
// So we count delegations per supervisor run ourselves.
const used = new Map<string, number>();

export const delegationPolicy = {
  // 0) A boundary must fail CLOSED: if a hook throws, the delegation fails (default would be: continue unfiltered)
  hookErrorStrategy: 'throw' as const,

  // 1) Context boundary: specialists never see customer PII, and only the last few messages.
  messageFilter: ({ messages }: { messages: any[] }) => redactDeep(messages).slice(-6),

  // 2) Budget + prompt hygiene before every delegation
  onDelegationStart: async (ctx: any) => {
    const n = (used.get(ctx.runId) ?? 0) + 1;
    used.set(ctx.runId, n);
    if (used.size > 1000) used.delete(used.keys().next().value!);
    if (n > MAX_DELEGATIONS) {
      return { proceed: false, rejectionReason: `Delegation budget (${MAX_DELEGATIONS}) used up. Decide with the findings you have.` };
    }
    reportDelegation({ phase: 'start', agent: String(ctx.primitiveId), prompt: String(ctx.prompt ?? '') }); // observation for the Desk UI only
    return { proceed: true, modifiedPrompt: redact(ctx.prompt ?? '') };
  },

  // 3) Don't let an empty answer look like success
  onDelegationComplete: async (ctx: any) => {
    reportDelegation({ phase: 'end', agent: String(ctx.primitiveId), ok: !!ctx.success, answer: String(ctx.result?.text ?? '') });
    if (!ctx.success) return { resultText: `${ctx.primitiveId} failed. Do not retry blindly; continue with other evidence.` };
    if (!ctx.result?.text?.trim()) return { resultText: `${ctx.primitiveId} returned no findings.` };
    return undefined;
  },
};
