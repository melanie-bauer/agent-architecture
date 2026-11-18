// Deterministic scorer: are the findings grounded in evidence that actually exists?
// Cheap, reproducible, runs in CI. (LLM-as-judge scorers are possible, but start here.)
import { createScorer } from '@mastra/core/evals';
import { deploys, logs } from './data/incident-data';

const known = new Set([...logs.map((l) => l.id), ...deploys.map((d) => d.version)]);

export const evidenceGrounded = createScorer({
  id: 'evidence-grounded',
  description: 'Share of cited evidence ids that exist in logs/deploys. 0 if nothing is cited.',
}).generateScore(({ run }) => {
  const out: any = run.output;
  const evidence: string[] = out?.evidence ?? out?.findings?.evidence ?? [];
  if (!evidence.length) return 0;
  return evidence.filter((e) => known.has(e)).length / evidence.length;
});
