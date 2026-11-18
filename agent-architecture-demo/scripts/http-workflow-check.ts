// Checks the workflow over HTTP (same API Studio uses): start INC-4711, expect suspend, resume with approval.
// Needs a running `npm run dev`.  Usage: npx tsx scripts/http-workflow-check.ts
import { MastraClient } from '@mastra/client-js';

const client = new MastraClient({ baseUrl: process.env.MASTRA_URL ?? 'http://localhost:4111' });
const wf = client.getWorkflow('incidentTriage');
const run = await wf.createRun();
const started: any = await run.startAsync({ inputData: { ticketId: 'INC-4711' } });
console.log('status:', started.status, '| suspended at:', JSON.stringify(started.suspended));
console.log('question:', started.suspendPayload?.['incident-path']?.question);
if (started.status === 'suspended') {
  const resumed: any = await run.resumeAsync({ step: started.suspended[0], resumeData: { approved: true, approver: 'http-check' } });
  console.log('after resume:', resumed.status, JSON.stringify(resumed.result));
}
