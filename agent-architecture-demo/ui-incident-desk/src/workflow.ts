// Workflow tab: runs the incidentTriage workflow on the server (POST /desk/workflow) and draws it live.
// The server translates Mastra's workflow stream into AG-UI events (see server/workflow-route.ts):
//   STEP_STARTED / STEP_FINISHED   one per workflow step (nested steps as "incident-path.investigate")
//   CUSTOM desk.ticket             the ticket as it arrived, before load-ticket
//   CUSTOM desk.stepResult         a step's output
//   CUSTOM desk.delegation         the investigator asks a specialist, and the answer
//   CUSTOM desk.specialistInput    what the specialist's model received
//   RUN_FINISHED                   outcome interrupt while the approval waits, success at the end
import { $, el, icon, pin, keepBottom, markSent, markReceived, readSse, setStatus } from './shared';

type StepKey = 'load-ticket' | 'classify' | 'branch' | 'create-backlog-item' | 'investigate' | 'approve' | 'execute';
type StepState = 'todo' | 'running' | 'waiting' | 'done' | 'skipped';

const STEP_OF: Record<string, StepKey> = {
  'load-ticket': 'load-ticket',
  classify: 'classify',
  'create-backlog-item': 'create-backlog-item',
  'incident-path.investigate': 'investigate',
  'incident-path.approve-remediation': 'approve',
  'incident-path.execute-remediation': 'execute',
};
const INCIDENT_PATH: StepKey[] = ['investigate', 'approve', 'execute'];
const LABEL: Record<StepKey, string> = {
  'load-ticket': 'load-ticket',
  classify: 'classify',
  branch: 'branch',
  'create-backlog-item': 'create-backlog-item',
  investigate: 'investigate',
  approve: 'approve-remediation',
  execute: 'execute-remediation',
};
const AGENT_CLASS: Record<string, string> = { logAnalyst: 'a-logAnalyst', deployHistorian: 'a-deployHistorian' };

export function initWorkflow() {
  const flow = $('#wf-flow');
  const meta = $('#wf-run');
  const timeline = $('#wf-timeline');
  const rawBox = $('#wf-raw');
  const rawList = $('#wf-raw-list');
  const startButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-ticket]')];
  const stations = new Map<StepKey, HTMLElement>(
    [...flow.querySelectorAll<HTMLElement>('.fstep')].map((li) => [li.dataset.step as StepKey, li]),
  );

  let busy = false;
  let resuming = false;
  let runNo = 0;
  let eventCount = 0;
  let ticketRaw = '';
  let pendingApproval = false;
  let delegs: { agent: string; card: HTMLElement; recv: HTMLElement; offered: HTMLElement; answer: HTMLElement; received: boolean }[] = [];

  // ------------------------------------------------------------ stations
  const station = (k: StepKey) => stations.get(k)!;
  const detail = (k: StepKey) => station(k).querySelector<HTMLElement>('.detail')!;
  function setState(k: StepKey, st: StepState) {
    const li = station(k);
    li.dataset.state = st;
    const mark = li.querySelector('.station')!;
    mark.replaceChildren(st === 'done' ? icon('check') : st === 'waiting' ? icon('pause') : document.createTextNode(''));
    const tag = li.querySelector<HTMLElement>('.fstate')!;
    tag.textContent = { todo: '', running: 'Running', waiting: 'Waiting for you', done: 'Done', skipped: 'Skipped by the branch' }[st];
    if (st === 'running' || st === 'waiting') li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function resetFlow() {
    for (const [k, li] of stations) {
      setState(k, 'todo');
      li.querySelector('.detail')!.replaceChildren();
    }
    delegs = [];
    ticketRaw = '';
    pendingApproval = false;
  }

  // ------------------------------------------------------------ details per step
  function showLoaded(text: string) {
    const box = el('div', 'compare');
    const left = el('div');
    const right = el('div');
    const a = el('div', 'box');
    const b = el('div', 'box');
    const hadPII = markSent(a, ticketRaw);
    markReceived(b, text);
    left.append(el('h4', '', 'Ticket as it arrived'), a);
    right.append(el('h4', '', 'After load-ticket'), b);
    box.append(left, right);
    const verdict = el('div', 'verdict');
    verdict.append(icon('shield'), document.createTextNode(hadPII ? 'Customer data removed once, at the entrance. No later step sees it.' : 'No customer data in this ticket.'));
    detail('load-ticket').replaceChildren(box, verdict);
  }

  function showTriage(t: any) {
    const row = el('div', 'facts');
    for (const [k, v] of [['severity', t.severity], ['service', t.service], ['category', t.category]]) {
      const f = el('span', `fact ${k === 'severity' ? `sev-${v}` : ''}`);
      f.append(el('span', 'k', k), el('b', '', String(v)));
      row.append(f);
    }
    detail('classify').replaceChildren(row, el('p', 'quiet', t.summary));
    // the branch is plain code: show the condition and the path it picks
    const sev3 = t.severity === 'sev3';
    const lanes = el('div', 'lanes');
    const lane = (on: boolean, cond: string, target: string) => {
      const l = el('div', `lane ${on ? 'taken' : 'not-taken'}`);
      l.append(el('code', '', cond), el('span', 'to', target));
      return l;
    };
    lanes.append(lane(sev3, 'severity === "sev3"', 'create-backlog-item'), lane(!sev3, 'severity !== "sev3"', 'incident-path'));
    detail('branch').replaceChildren(
      el('p', '', sev3 ? `Severity is ${t.severity}, so the code files a backlog item. No investigation, no large model.` : `Severity is ${t.severity}, so the code takes the incident path.`),
      lanes,
    );
    setState('branch', 'done');
    if (sev3) INCIDENT_PATH.forEach((k) => setState(k, 'skipped'));
    else setState('create-backlog-item', 'skipped');
  }

  function newDelegation(agent: string, prompt: string) {
    const card = el('div', `deleg ${AGENT_CLASS[agent] ?? ''}`);
    const head = el('div', 'deleg-head');
    head.append(pin(), document.createTextNode('Investigator asks '), el('span', 'ag', agent));
    const compare = el('div', 'compare');
    const left = el('div');
    const right = el('div');
    const sent = el('div', 'box');
    markSent(sent, prompt);
    const recv = el('div', 'box waiting', `Waiting for ${agent} to start.`);
    left.append(el('h4', '', 'Investigator sent'), sent);
    right.append(el('h4', '', `${agent} received`), recv);
    compare.append(left, right);
    const offered = el('div', 'offered');
    const answer = el('div', 'answer');
    card.append(head, compare, offered, answer);
    keepBottom(flow, () => detail('investigate').append(card));
    delegs.push({ agent, card, recv, offered, answer, received: false });
  }

  function showReceived(v: { agent: string; received: string; sawCustomerPII: boolean; tools: string[] }) {
    const d = [...delegs].reverse().find((x) => x.agent === v.agent && !x.received);
    if (!d) return;
    d.received = true;
    d.recv.classList.remove('waiting');
    markReceived(d.recv, v.received);
    d.offered.replaceChildren(document.createTextNode(`Tools offered to ${v.agent}:`));
    for (const t of v.tools) {
      const c = el('span', 'chip');
      c.append(el('code', '', t), document.createTextNode('read'));
      d.offered.append(c);
    }
  }

  function showAnswer(agent: string, ok: boolean, text: string) {
    const d = [...delegs].reverse().find((x) => x.agent === agent);
    if (!d) return;
    const who = el('div', 'who');
    who.append(pin(), document.createTextNode(ok ? `${agent} answered` : `${agent} failed`));
    d.answer.replaceChildren(who, el('div', '', text));
  }

  function showFindings(f: any) {
    const box = el('div', 'findings');
    const h = el('h4', '', 'Findings, as structured output');
    const cause = el('p', 'cause', f.rootCause);
    const ev = el('div', 'facts');
    for (const e of f.evidence ?? []) ev.append(el('span', 'fact ev', e));
    const prop = el('p', 'proposal');
    const a = f.proposedAction ?? {};
    prop.append(el('b', '', 'Proposal: '), document.createTextNode(a.type === 'none' ? 'no action' : `${a.type} ${a.service}${a.toVersion ? ` to ${a.toVersion}` : ''}`), document.createTextNode(`, confidence ${f.confidence}.`));
    box.append(h, cause, el('span', 'k', 'Evidence'), ev, prop, el('p', 'quiet', 'The investigator holds no write tools. It can only propose.'));
    keepBottom(flow, () => detail('investigate').append(box));
  }

  function showApproval(meta: { runId: string; question?: string; proposal?: any; evidence?: string[] }) {
    pendingApproval = true;
    const card = el('section', 'approval inline');
    card.setAttribute('aria-label', 'Approval request');
    const top = el('div', 'approval-top');
    top.append(icon('pause'), document.createTextNode('Your decision'), el('span', 'tier', 'Write, reversible'));
    const body = el('div', 'approval-body');
    const p = meta.proposal ?? {};
    body.append(el('div', 'approval-ask', p.type === 'rollback' ? `Roll back ${p.service} to ${p.toVersion}` : meta.question ?? 'Approve the proposal?'));
    if (meta.evidence?.length) {
      const ev = el('div', 'facts');
      ev.append(el('span', 'k', 'Evidence'));
      for (const e of meta.evidence) ev.append(el('span', 'fact ev', e));
      body.append(ev);
    }
    const stateBox = el('div', 'state-box');
    const st = el('div');
    st.append(el('b', '', 'The workflow is paused. '), document.createTextNode('Its snapshot is stored in the database, and nothing is running. A new request resumes it, even after a restart.'));
    stateBox.append(icon('pause'), st);
    const decide = el('div', 'decide');
    const label = el('label');
    const reason = el('input');
    reason.type = 'text';
    reason.placeholder = 'For example: Change freeze until 16:00';
    label.append(document.createTextNode('Reason if you decline (stored with the run)'), reason);
    const no = el('button', 'decline');
    no.type = 'button';
    no.append(icon('x'), document.createTextNode('Decline'));
    const yes = el('button', 'approve');
    yes.type = 'button';
    yes.append(icon('check'), document.createTextNode('Approve'));
    decide.append(label, no, yes);
    body.append(stateBox, decide);
    card.append(top, body);
    detail('approve').replaceChildren(card);
    setState('approve', 'waiting');
    syncControls();
    const decided = (ok: boolean, why: string) => {
      pendingApproval = false;
      card.classList.add('answered');
      top.replaceChildren(icon(ok ? 'check' : 'x'), document.createTextNode(ok ? 'You approved the rollback.' : `You declined.${why ? ` Reason: ${why}` : ''}`));
      run({ action: 'resume', runId: meta.runId, approved: ok, comment: why || undefined }, ok ? 'Resume, approved' : 'Resume, declined');
    };
    yes.onclick = () => decided(true, '');
    no.onclick = () => decided(false, reason.value.trim());
  }

  function showOutcome(k: StepKey, out: any) {
    const ok = (out?.actionsExecuted ?? []).length > 0;
    const box = el('div', `outcome ${ok ? 'ran' : ''}`);
    box.append(el('p', '', out?.outcome ?? ''));
    if (k === 'execute') box.append(el('p', 'quiet', ok ? 'Plain code ran the rollback after checking the allow list of earlier deployed versions.' : 'Plain code decided not to change anything.'));
    detail(k).replaceChildren(box);
  }

  // ------------------------------------------------------------ event reducer
  function reduce(ev: any) {
    switch (ev.type) {
      case 'RUN_STARTED':
        setStatus('workflow', 'running');
        meta.textContent = `Run ${ev.runId.slice(0, 8)}`;
        break;
      case 'STEP_STARTED': {
        if (ev.stepName === 'incident-path') break;
        const k = STEP_OF[ev.stepName];
        if (k) setState(k, 'running');
        break;
      }
      case 'CUSTOM': {
        const v = ev.value;
        if (ev.name === 'desk.ticket') ticketRaw = v.raw;
        else if (ev.name === 'desk.delegation') v.phase === 'start' ? newDelegation(v.agent, v.prompt) : showAnswer(v.agent, v.ok, v.answer);
        else if (ev.name === 'desk.specialistInput') showReceived(v);
        else if (ev.name === 'desk.stepResult') {
          const k = STEP_OF[v.step];
          if (!k) break;
          if (k === 'load-ticket') showLoaded(v.output?.text ?? '');
          if (k === 'classify') showTriage(v.output?.triage ?? {});
          if (k === 'investigate') showFindings(v.output?.findings ?? {});
          if (k === 'approve') {
            const o = v.output ?? {};
            const line = el('p', `decision ${o.approved ? 'yes' : 'no'}`);
            line.append(icon(o.approved ? 'check' : 'x'), document.createTextNode(`${o.approved ? 'Approved' : 'Declined'} by ${o.approver}${o.comment ? `: ${o.comment}` : '.'}`));
            const card = detail('approve').querySelector('.approval');
            detail('approve').replaceChildren(...(card ? [card] : []), line);
          }
          if (k === 'execute' || k === 'create-backlog-item') showOutcome(k, v.output);
          setState(k, v.status === 'success' ? 'done' : 'todo');
        }
        break;
      }
      case 'RUN_FINISHED': {
        const intr = ev.outcome?.type === 'interrupt' ? ev.outcome.interrupts?.[0] : undefined;
        if (intr) {
          showApproval(intr.metadata?.workflow ?? {});
          setStatus('workflow', 'waiting');
        } else setStatus('workflow', 'idle');
        break;
      }
      case 'RUN_ERROR':
        flow.prepend(el('div', 'error-msg', `The workflow failed: ${ev.message ?? 'unknown error'}`));
        setStatus('workflow', 'error');
        break;
    }
  }

  // ------------------------------------------------------------ timeline and raw events
  let runBody: HTMLElement | undefined;
  let runStatus: HTMLElement | undefined;
  let seg: { who: string; el: HTMLElement } | undefined;
  let t0 = 0;

  function startRunView(label: string) {
    timeline.querySelector('.tl-empty')?.remove();
    const box = el('section', 'run');
    const head = el('div', 'run-head');
    runStatus = el('span', 'rs', 'Running');
    head.append(el('b', '', `Run ${runNo}: ${label}`), runStatus);
    runBody = el('div');
    box.append(head, runBody);
    keepBottom(timeline, () => timeline.append(box));
    seg = undefined;
    t0 = performance.now();
  }

  function tlRow(who: string, sentence: string, type: string, cls = '') {
    if (!runBody) return;
    keepBottom(timeline, () => {
      if (!seg || seg.who !== who) {
        const s = el('div', `seg-agent ${AGENT_CLASS[who] ?? (who === 'Workflow' ? 'a-commander' : 'a-investigator')}`);
        const w = el('div', 'who');
        w.append(pin(), document.createTextNode(who));
        s.append(w);
        runBody!.append(s);
        seg = { who, el: s };
      }
      const row = el('div', `row ${cls}`);
      row.append(el('span', 's', sentence), el('span', 't', type));
      seg.el.append(row);
    });
  }

  function timelineFor(ev: any) {
    switch (ev.type) {
      case 'RUN_STARTED':
        tlRow('Workflow', resuming ? 'Run resumed from the stored snapshot' : 'Run started', ev.type, 'key');
        break;
      case 'STEP_STARTED':
      case 'STEP_FINISHED': {
        if (ev.stepName === 'incident-path') {
          tlRow('Workflow', ev.type === 'STEP_STARTED' ? 'Entered the nested workflow incident-path' : 'Left incident-path', ev.type);
          break;
        }
        const k = STEP_OF[ev.stepName];
        const name = k ? LABEL[k] : ev.stepName;
        tlRow('Workflow', ev.type === 'STEP_STARTED' ? `Step ${name} started` : `Step ${name} finished`, ev.type, ev.type === 'STEP_FINISHED' ? '' : 'key');
        break;
      }
      case 'CUSTOM': {
        const v = ev.value;
        if (ev.name === 'desk.delegation')
          tlRow(v.phase === 'start' ? 'Investigator' : v.agent, v.phase === 'start' ? `Investigator delegates to ${v.agent}` : `${v.agent}'s answer went back to the investigator`, 'CUSTOM');
        else if (ev.name === 'desk.specialistInput')
          tlRow(v.agent, v.sawCustomerPII ? `${v.agent} received customer data` : `${v.agent} received the request without customer data`, 'CUSTOM', v.sawCustomerPII ? 'bad' : 'redact');
        else if (ev.name === 'desk.ticket') tlRow('Workflow', `Ticket ${v.ticketId} arrived`, 'CUSTOM');
        else if (ev.name === 'desk.stepResult') {
          const k = STEP_OF[v.step];
          if (k === 'classify') tlRow('Workflow', `Triage said ${v.output?.triage?.severity}, the branch picks the ${v.output?.triage?.severity === 'sev3' ? 'backlog' : 'incident path'}`, 'CUSTOM', 'key');
        }
        break;
      }
      case 'RUN_FINISHED': {
        const intr = ev.outcome?.type === 'interrupt';
        tlRow('Workflow', intr ? 'Run ended with an interrupt: the approval waits as stored state. Nothing is running.' : 'Run finished', ev.type, intr ? 'waiting' : 'key');
        if (runStatus) {
          runStatus.textContent = intr ? 'Waiting for you' : `Finished in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
          runStatus.className = `rs ${intr ? 'waiting' : ''}`;
        }
        break;
      }
      case 'RUN_ERROR':
        tlRow('Workflow', `Run failed: ${ev.message ?? 'unknown error'}`, ev.type, 'bad');
        if (runStatus) {
          runStatus.textContent = 'Failed';
          runStatus.className = 'rs error';
        }
        break;
    }
  }

  function rawFor(ev: any) {
    eventCount++;
    $('#wf-count').textContent = String(eventCount);
    const row = el('details', 'ev');
    const sum = el('summary');
    const { type, ...rest } = ev;
    const hint = ev.stepName ?? (ev.type === 'CUSTOM' ? ev.name : ev.type === 'RUN_FINISHED' ? ev.outcome?.type : '');
    sum.append(el('span', 'ty', type));
    if (hint) sum.append(el('span', 'hint', String(hint)));
    row.append(sum, el('pre', '', JSON.stringify(rest, null, 2)));
    keepBottom(rawBox, () => rawList.append(row));
  }

  // ------------------------------------------------------------ requests
  function syncControls() {
    for (const b of startButtons) b.disabled = busy;
  }

  async function run(body: any, label: string) {
    busy = true;
    resuming = body.action === 'resume';
    runNo++;
    syncControls();
    startRunView(label);
    try {
      const res = await fetch('/desk/workflow', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) });
      await readSse(res, (ev) => {
        rawFor(ev);
        reduce(ev);
        timelineFor(ev);
      });
    } catch (e: any) {
      reduce({ type: 'RUN_ERROR', message: String(e?.message ?? e) });
      timelineFor({ type: 'RUN_ERROR', message: String(e?.message ?? e) });
    } finally {
      busy = false;
      syncControls();
    }
  }

  startButtons.forEach((b) => {
    b.onclick = () => {
      if (busy) return;
      resetFlow();
      run({ action: 'start', ticketId: b.dataset.ticket }, b.dataset.ticket!);
    };
  });

  const viewBtns = { timeline: $<HTMLButtonElement>('#wf-view-timeline'), raw: $<HTMLButtonElement>('#wf-view-raw') };
  const setView = (v: 'timeline' | 'raw') => {
    viewBtns.timeline.setAttribute('aria-pressed', String(v === 'timeline'));
    viewBtns.raw.setAttribute('aria-pressed', String(v === 'raw'));
    timeline.hidden = v !== 'timeline';
    rawBox.hidden = v !== 'raw';
  };
  viewBtns.timeline.onclick = () => setView('timeline');
  viewBtns.raw.onclick = () => setView('raw');

  function reset() {
    if (busy) return;
    resetFlow();
    runNo = 0;
    eventCount = 0;
    $('#wf-count').textContent = '0';
    rawList.replaceChildren();
    timeline.replaceChildren(el('p', 'tl-empty', 'Each request to the workflow appears here as a run, with one line per step.'));
    meta.textContent = 'No run yet';
    setStatus('workflow', 'idle');
    syncControls();
  }
  reset();

  return { reset };
}
