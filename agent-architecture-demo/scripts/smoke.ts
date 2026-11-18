// Quick end-to-end check of the workflow (mock mode by default).
// Traces of CLI runs stay in memory, so this works while `npm run dev` holds the DuckDB trace file.
process.env.INCIDENT_DESK_TRACES ??= ':memory:';
process.env.DEMO_MODE ??= 'mock';
process.env.MOCK_LATENCY_MS ??= '0';
const { mastra } = await import('../src/mastra/index');
const { recorder } = await import('../src/mastra/model/recorder');
const wf = mastra.getWorkflow('incidentTriage');
for (const id of ['INC-4712', 'INC-4711']) {
  recorder.reset();
  const run = await wf.createRun();
  const r: any = await run.start({ inputData: { ticketId: id } });
  console.log(id, r.status, JSON.stringify(r.result ?? r.suspended ?? r.error)?.slice(0, 300));
  console.log(recorder.calls.map((c) => `${c.agentId}(tools=${c.toolsOffered},pii=${c.sawCustomerPII},in=${c.inputTokens})`).join(' | '));
  if (r.status === 'suspended') {
    const r2: any = await run.resume({ step: r.suspended[0], resumeData: { approved: true, approver: 'melanie' } });
    console.log('resumed', r2.status, JSON.stringify(r2.result)?.slice(0, 300), recorder.actions);
  }
}
process.exit(0);
