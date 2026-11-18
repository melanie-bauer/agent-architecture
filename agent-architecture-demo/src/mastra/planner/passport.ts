// The passport data boundary of the second request.
// Only Travel holds the readPassports tool (the single agent holds every tool, so it holds this one too).
// Three things are enforced in code, not by prompt:
//   1. Who saw passport data is measured: every model call of a planner agent is checked for passport numbers (models.ts).
//   2. Whatever leaves Travel (answers to the hub or to peers, board posts, plan entries) is redacted to [passport].
//   3. The viz trace that the UI shows is redacted too.
// Demo grade: the check looks for the known passport numbers of the fake registry, not for anything that looks like one.
import { passports } from './data';
import type { PlanMode } from './viz';

const NUMBERS = passports.map((p) => p.passportNo);
const ANY = new RegExp(NUMBERS.join('|'), 'g');

export const containsPassport = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return NUMBERS.some((n) => s.includes(n));
};

/** Replace passport numbers with [passport]; returns the text and how many were replaced. */
export function redactPassports(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(ANY, () => (count++, '[passport]'));
  return { text: out, count };
}
export const redactDeep = <T>(v: T): T => (containsPassport(v) ? JSON.parse(redactPassports(JSON.stringify(v)).text) : v);

// ---- who saw passport data, per mode (reset with the plan of that mode) ----
const g = globalThis as any;
g.__plannerPassportSeen ??= { single: new Set<string>(), centralized: new Set<string>(), decentralized: new Set<string>() };
const seen: Record<PlanMode, Set<string>> = g.__plannerPassportSeen;

export function markPassportSeen(mode: PlanMode, node: string) {
  seen[mode].add(node);
}
export const passportSeenBy = (mode: PlanMode) => [...seen[mode]].sort();
export function resetPassportSeen(mode?: PlanMode) {
  for (const m of mode ? [mode] : (Object.keys(seen) as PlanMode[])) seen[m].clear();
}
/** Who may see passport data in each mode: Travel, or the single agent that holds every tool. */
export const PASSPORT_ALLOWED: Record<PlanMode, string[]> = { single: ['single'], centralized: ['travel'], decentralized: ['travel'] };
