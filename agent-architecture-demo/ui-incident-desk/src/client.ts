// Incident Desk UI, Chat tab: a deliberately small AG-UI client. Entry point of the bundle (tabs.ts wires the other tabs).
// Everything on the page is drawn from the AG-UI event stream (a reducer over typed events):
//   left    demo steps (what each one shows) and who holds which tools (/desk/info)
//   middle  the conversation: delegations (sent vs. received), tool calls, approval card
//   right   the same events as a readable timeline, or raw
// Uses @ag-ui/client's HttpAgent (message state, resume) and renders events by hand.
import { HttpAgent } from '@ag-ui/client';
import { $, el, icon, pin, keepBottom, fmtArgs, parse, listNames, markSent, markReceived, setStatus as setTabStatus, type RunState } from './shared';
import { initTabs } from './tabs';

// ---------------------------------------------------------------- page elements
const chat = $('#chat');
const timeline = $('#timeline');
const rawBox = $('#raw');
const rawList = $('#raw-list');
const input = $<HTMLTextAreaElement>('#input');
const sendBtn = $<HTMLButtonElement>('#send');
const stepEls = [...document.querySelectorAll<HTMLElement>('.step')];
const stepButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-prompt]')];

// ---------------------------------------------------------------- state
type Tier = 'read' | 'write' | 'irreversible';
type RosterAgent = { id: string; tools: { name: string; tier: Tier; needsApproval: boolean }[] };
type SpecialistInput = { agent: string; received: string; sawCustomerPII: boolean; tools: string[] };
type StepState = 'todo' | 'running' | 'waiting' | 'done';
type Step = { state: StepState; inputs: SpecialistInput[]; sentPII: boolean; delegatedTo: string[]; decisions: string[] };

let info: { mode?: 'live' | 'mock'; models?: { large: string; small: string }; agents?: RosterAgent[] } = {};
let threadId = '';
let agent: HttpAgent;
let busy = false;
let pending = 0; // approval cards waiting for a decision
let activeStep: number | null = null;
let runNo = 0;
let finishedRuns = 0;
let eventCount = 0;
let steps: Step[] = [];

type Deleg = { agent: string; el: HTMLElement; sent: HTMLElement; recv: HTMLElement; verdict: HTMLElement; offered: HTMLElement; calls: HTMLElement; state: HTMLElement; args: string; subRun?: string; received?: SpecialistInput; answer?: HTMLElement };
let delegs: Deleg[] = [];
let byToolCall = new Map<string, Deleg>();
let subagents = new Map<string, { name: string; deleg?: Deleg }>();
let calls = new Map<string, { el: HTMLElement; argsEl: HTMLElement; name: string; args: string }>();
let texts = new Map<string, HTMLElement>();

const tierOf = (tool: string): Tier =>
  info.agents?.flatMap((a) => a.tools).find((t) => t.name === tool)?.tier ?? 'write';
const agentOf = (ev: any): string => (ev.subagentRunId ? subagents.get(ev.subagentRunId)?.name ?? 'subagent' : 'commander');
const agentLabel = (a: string) => (a === 'commander' || a === 'incidentCommander' ? 'Commander' : a);
const agentClass = (a: string) => `a-${a === 'incidentCommander' ? 'commander' : a}`;

// ---------------------------------------------------------------- top bar
const setStatus = (state: RunState) => setTabStatus('chat', state);

function showUsage(usage: any[]) {
  if (!usage?.length) return;
  const total = usage.reduce((s, u) => s + (u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)), 0);
  const how = info.mode === 'live' ? 'measured (live)' : 'estimated (mock)';
  $('#usage').textContent = `Last run: ${total.toLocaleString('en-US')} tokens, ${how}`;
}

// ---------------------------------------------------------------- steps
function renderSteps() {
  const active = steps.some((s) => s.state === 'running' || s.state === 'waiting');
  let nextShown = false;
  steps.forEach((st, i) => {
    const li = stepEls[i];
    let shown: string = st.state;
    if (st.state === 'todo' && !active && !nextShown) {
      shown = 'next';
      nextShown = true;
    }
    if (li.dataset.state !== shown && (shown === 'running' || shown === 'waiting' || shown === 'next')) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    li.dataset.state = shown;
    const station = li.querySelector('.station')!;
    station.replaceChildren(st.state === 'done' ? icon('check') : document.createTextNode(String(i + 1)));
    const proof = li.querySelector<HTMLElement>('.proof')!;
    const p = proofFor(i, st);
    proof.textContent = p.text;
    proof.className = `proof ${p.cls}`;
  });
}

function proofFor(i: number, st: Step): { text: string; cls: string } {
  if (st.state === 'waiting')
    return { text: 'The run has ended. Nothing is running. Your approval waits as state in the thread.', cls: 'warn' };
  if (i === 1 && st.state === 'todo' && st.decisions.length)
    return { text: `You ${st.decisions.join(', ')}. Nothing was changed. Run Mitigate again to approve.`, cls: 'warn' };
  if (st.state !== 'done') return { text: '', cls: '' };
  if (i === 0) {
    const names = [...new Set(st.inputs.map((x) => x.agent))];
    const leaked = [...new Set(st.inputs.filter((x) => x.sawCustomerPII).map((x) => x.agent))];
    if (!names.length) return { text: 'The commander answered without asking a specialist this time.', cls: 'warn' };
    if (leaked.length) return { text: `${listNames(leaked)} saw customer data.`, cls: 'bad' };
    return {
      text: `${listNames(names)} never saw the customer's name, email or card.${st.sentPII ? ' The hook removed what the commander pasted in.' : ''}`,
      cls: '',
    };
  }
  if (i === 1) {
    if (!st.decisions.length) return { text: 'The commander did not ask for a write this time.', cls: 'warn' };
    const approved = st.decisions.some((d) => d.startsWith('approved'));
    const declines = st.decisions.filter((d) => d.startsWith('declined')).length;
    const approvedTools = st.decisions.filter((d) => d.startsWith('approved')).map((d) => d.slice(9));
    return {
      text: approved
        ? `${declines ? `You declined ${declines} request${declines === 1 ? '' : 's'}, then approved ${listNames(approvedTools)}. ` : `You approved ${listNames(approvedTools)}. `}Each write ran only after your approval.`
        : 'Nothing was changed.',
      cls: '',
    };
  }
  const earlier = finishedRuns - 1;
  const asked = [...new Set(st.delegatedTo)];
  return {
    text: `Answered in the same thread, on top of ${earlier} earlier run${earlier === 1 ? '' : 's'}.${asked.length ? ` It asked ${listNames(asked)} for details.` : ''}`,
    cls: '',
  };
}

// ---------------------------------------------------------------- roster
function renderRoster() {
  const box = $('#roster');
  box.replaceChildren();
  for (const a of info.agents ?? []) {
    const row = el('div', `agent-row ${agentClass(a.id)}`);
    const name = el('div', 'agent-name');
    name.append(pin(), document.createTextNode(agentLabel(a.id)));
    const chips = el('div', 'chips');
    for (const t of a.tools) {
      const c = el('span', `chip ${t.tier === 'read' ? '' : 'write'}`);
      c.append(el('code', '', t.name), document.createTextNode(t.tier === 'read' ? 'read' : t.needsApproval ? 'needs approval' : 'NO approval'));
      chips.append(c);
    }
    row.append(name, chips);
    box.append(row);
  }
}

// ---------------------------------------------------------------- conversation pieces
function addToChat(node: HTMLElement) {
  $('#empty')?.remove();
  keepBottom(chat, () => {
    const card = chat.querySelector('.approval:not(.answered)');
    if (card && node !== card) chat.insertBefore(node, card);
    else chat.append(node);
  });
}

function newDelegation(name: string): Deleg {
  const card = el('div', `deleg ${agentClass(name)}`);
  const head = el('div', 'deleg-head');
  const state = el('span', 'deleg-state', 'Request sent');
  head.append(pin(), document.createTextNode('Commander asks '), el('span', 'ag', name), state);
  const compare = el('div', 'compare');
  const left = el('div');
  const right = el('div');
  const sent = el('div', 'box');
  const recv = el('div', 'box waiting', `Waiting for ${name} to start.`);
  left.append(el('h4', '', 'Commander sent'), sent);
  right.append(el('h4', '', `${name} received`), recv);
  compare.append(left, right);
  const verdict = el('div', 'verdict');
  const offered = el('div', 'offered');
  const callsBox = el('div', 'calls');
  card.append(head, compare, verdict, offered, callsBox);
  addToChat(card);
  const d: Deleg = { agent: name, el: card, sent, recv, verdict, offered, calls: callsBox, state, args: '' };
  delegs.push(d);
  if (activeStep !== null) steps[activeStep].delegatedTo.push(name);
  return d;
}

function showReceived(d: Deleg, v: SpecialistInput) {
  d.received = v;
  d.recv.classList.remove('waiting');
  markReceived(d.recv, v.received);
  const sentPII = d.sent.querySelector('mark.pii') !== null;
  d.verdict.replaceChildren();
  if (v.sawCustomerPII) {
    d.verdict.className = 'verdict bad';
    d.verdict.append(icon('alert'), document.createTextNode(`${v.agent} saw customer data.`));
  } else {
    d.verdict.className = 'verdict';
    d.verdict.append(
      icon('shield'),
      document.createTextNode(sentPII ? `Customer data removed before ${v.agent} saw the request.` : `No customer data in what ${v.agent} received.`),
    );
  }
  d.offered.replaceChildren(document.createTextNode(`Tools offered to ${v.agent}:`));
  for (const t of v.tools) {
    const c = el('span', `chip ${tierOf(t) === 'read' ? '' : 'write'}`);
    c.append(el('code', '', t), document.createTextNode(tierOf(t) === 'read' ? 'read' : 'write'));
    d.offered.append(c);
  }
  if (activeStep !== null) {
    steps[activeStep].inputs.push(v);
    if (sentPII) steps[activeStep].sentPII = true;
  }
}

function newCall(ev: any) {
  const name = ev.toolCallName as string;
  const parent = ev.subagentRunId ? subagents.get(ev.subagentRunId)?.deleg : undefined;
  const isWrite = !ev.subagentRunId && tierOf(name) !== 'read';
  const row = el('div', `call ${isWrite ? 'ran-write' : ''}`);
  const label = el('span', '', isWrite ? 'Ran after your approval:' : parent ? 'Calls' : 'Commander calls');
  const argsEl = el('code');
  row.append(label, el('span', 'tname', name), argsEl);
  if (parent) keepBottom(chat, () => parent.calls.append(row));
  else addToChat(row);
  calls.set(ev.toolCallId, { el: row, argsEl, name, args: '' });
}

// ---------------------------------------------------------------- approval card
const ASK: Record<string, (a: any) => string> = {
  rollbackDeploy: (a) => `Roll back ${a.service} to ${a.toVersion}`,
  restartService: (a) => `Restart all pods of ${a.service}`,
  postStatusUpdate: () => 'Publish a message on the public status page',
  scaleService: (a) => `Scale ${a.service} to ${a.replicas} replicas`,
  setFeatureFlag: (a) => `${a.enabled ? 'Turn on' : 'Turn off'} the flag ${a.flag}`,
};

function renderApproval(intr: any) {
  const m = intr.metadata?.mastra ?? {};
  const tool: string = m.toolName ?? 'a tool';
  const args: Record<string, unknown> = m.args ?? {};
  const tier = tierOf(tool);
  const stepIdx = activeStep;
  pending++;

  const card = el('section', 'approval');
  card.setAttribute('aria-label', 'Approval request');
  const top = el('div', 'approval-top');
  top.append(icon('pause'), document.createTextNode('Your decision'), el('span', 'tier', tier === 'irreversible' ? 'Irreversible' : 'Write, reversible'));
  const body = el('div', 'approval-body');
  const ask = el('div');
  ask.append(el('div', 'approval-ask', (ASK[tool] ?? (() => `Run ${tool}`))(args)));
  const toolLine = el('div', 'approval-tool');
  toolLine.append(document.createTextNode('The commander requests the tool '), el('code', '', tool), document.createTextNode(' with these arguments.'));
  ask.append(toolLine);
  const table = el('table', 'args');
  for (const [k, v] of Object.entries(args)) {
    const tr = el('tr');
    tr.append(el('th', '', k), el('td', '', typeof v === 'string' ? v : JSON.stringify(v)));
    table.append(tr);
  }
  const stateBox = el('div', 'state-box');
  const st = el('div');
  st.append(el('b', '', 'The run has ended. '), document.createTextNode('AG-UI sent '), el('code', '', 'RUN_FINISHED'), document.createTextNode(' with the outcome '), el('code', '', 'interrupt'), document.createTextNode('. Nothing is running. The request is stored with the thread until you decide.'));
  stateBox.append(icon('pause'), st);
  const decide = el('div', 'decide');
  const label = el('label');
  const reason = el('input');
  reason.type = 'text';
  reason.placeholder = 'For example: Change freeze until 16:00';
  label.append(document.createTextNode('Reason if you decline (sent to the commander)'), reason);
  const no = el('button', 'decline');
  no.type = 'button';
  no.append(icon('x'), document.createTextNode('Decline'));
  const yes = el('button', 'approve');
  yes.type = 'button';
  yes.append(icon('check'), document.createTextNode('Approve'));
  decide.append(label, no, yes);
  body.append(ask, table, stateBox, decide);
  card.append(top, body);
  keepBottom(chat, () => chat.append(card));
  chat.scrollTop = chat.scrollHeight;
  syncControls();
  reason.focus({ preventScroll: true });

  const decided = (text: string, ok: boolean) => {
    pending--;
    card.classList.add('answered');
    top.replaceChildren(icon(ok ? 'check' : 'x'), document.createTextNode(text));
    if (stepIdx !== null) steps[stepIdx].decisions.push(`${ok ? 'approved' : 'declined'} ${tool}`);
    const mark = el('div', 'run-mark resume', 'Run resumed with your decision');
    chat.append(mark);
    chat.scrollTop = chat.scrollHeight;
    activeStep = stepIdx;
  };
  yes.onclick = async () => {
    decided(`You approved ${tool}.`, true);
    await run({ resume: [{ interruptId: intr.id, status: 'resolved', payload: { approved: true } }] }, `Resume, approved ${tool}`);
  };
  no.onclick = async () => {
    const why = reason.value.trim();
    decided(`You declined ${tool}.${why ? ` Reason: ${why}` : ''}`, false);
    await run({ resume: [{ interruptId: intr.id, status: 'resolved', payload: { approved: false } }] }, `Resume, declined ${tool}`);
    // The AG-UI bridge declines without a reason today, so the reason goes in as a normal message.
    if (why) await sendText(`I declined ${tool}. Reason: ${why}`, 'Decline reason', stepIdx);
  };
}

// ---------------------------------------------------------------- timeline
type RunView = { no: number; head: HTMLElement; status: HTMLElement; body: HTMLElement; seg?: { agent: string; el: HTMLElement }; t0: number };
let runView: RunView | undefined;
let rowsByKey = new Map<string, { s: HTMLElement; t: HTMLElement; n: number; type: string }>();

function startRunView(label: string) {
  timeline.querySelector('.tl-empty')?.remove();
  const box = el('section', 'run');
  const head = el('div', 'run-head');
  const status = el('span', 'rs', 'Running');
  head.append(el('b', '', `Run ${runNo}: ${label}`), status);
  const body = el('div');
  box.append(head, body);
  keepBottom(timeline, () => timeline.append(box));
  runView = { no: runNo, head, status, body, t0: performance.now() };
}

function tlRow(agentKey: string, sentence: string, type: string, cls = '', key?: string) {
  if (!runView) startRunView('Run');
  const rv = runView!;
  if (key && rowsByKey.has(key)) {
    const r = rowsByKey.get(key)!;
    r.n++;
    r.s.textContent = sentence;
    r.t.textContent = `${r.type} x ${r.n}`;
    if (cls) r.s.parentElement!.className = `row ${cls}`;
    return;
  }
  keepBottom(timeline, () => {
    if (!rv.seg || rv.seg.agent !== agentKey) {
      const seg = el('div', `seg-agent ${agentClass(agentKey)}`);
      const who = el('div', 'who');
      who.append(pin(), document.createTextNode(agentLabel(agentKey)));
      seg.append(who);
      rv.body.append(seg);
      rv.seg = { agent: agentKey, el: seg };
    }
    const row = el('div', `row ${cls}`);
    const s = el('span', 's', sentence);
    const t = el('span', 't', type);
    row.append(s, t);
    rv.seg.el.append(row);
    if (key) rowsByKey.set(key, { s, t, n: 1, type: type.replace(/_(START|CONTENT|END|ARGS|RESULT)$/, '_*') });
  });
}

function timelineFor(ev: any) {
  const a = agentOf(ev);
  const who = agentLabel(a);
  switch (ev.type) {
    case 'RUN_STARTED':
      tlRow('commander', runView?.head.textContent?.includes('Resume') ? 'Run resumed with your decision' : 'Run started', ev.type, 'key');
      break;
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_CONTENT':
    case 'TEXT_MESSAGE_END': {
      const words = (texts.get(ev.messageId)?.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
      tlRow(a, ev.type === 'TEXT_MESSAGE_END' ? `${who} answered (${words} words)` : `${who} is writing an answer`, ev.type, '', `text:${ev.messageId}`);
      break;
    }
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END':
    case 'TOOL_CALL_RESULT': {
      const id = ev.toolCallId;
      const d = byToolCall.get(id);
      if (d) {
        const s = ev.type === 'TOOL_CALL_RESULT' ? `${d.agent}'s answer went back to the commander` : `Commander delegates to ${d.agent}`;
        tlRow('commander', s, ev.type, ev.type === 'TOOL_CALL_RESULT' ? '' : 'key', ev.type === 'TOOL_CALL_RESULT' ? undefined : `tool:${id}`);
        break;
      }
      const c = calls.get(id);
      const name = c?.name ?? ev.toolCallName ?? 'a tool';
      const args = c ? parse(c.args) : undefined;
      const argText = args && Object.keys(args).length ? ` (${fmtArgs(args)})` : '';
      const s = ev.type === 'TOOL_CALL_RESULT' ? `${who} called ${name}${argText} and got a result` : `${who} calls ${name}${argText}`;
      tlRow(a, s, ev.type, '', `tool:${id}`);
      break;
    }
    case 'SUBAGENT_STARTED':
      tlRow(ev.name, `${ev.name} starts`, ev.type);
      break;
    case 'SUBAGENT_FINISHED':
      tlRow(a, `${who} finished`, ev.type);
      break;
    case 'SUBAGENT_ERROR':
      tlRow(a, `${who} failed`, ev.type, 'bad');
      break;
    case 'CUSTOM':
      if (ev.name === 'desk.specialistInput') {
        const v = ev.value as SpecialistInput;
        tlRow(v.agent, v.sawCustomerPII ? `${v.agent} received customer data` : `${v.agent} received the request without customer data`, `CUSTOM`, v.sawCustomerPII ? 'bad' : 'redact');
      } else tlRow(a, `Custom event ${ev.name}`, 'CUSTOM');
      break;
    case 'RUN_FINISHED': {
      const secs = ((performance.now() - (runView?.t0 ?? 0)) / 1000).toFixed(1);
      const intr = ev.outcome?.type === 'interrupt' ? ev.outcome.interrupts?.[0] : undefined;
      if (intr) {
        const tool = intr.metadata?.mastra?.toolName ?? 'a tool';
        tlRow('commander', `Run ended with an interrupt: ${tool} waits for your approval. Nothing is running.`, ev.type, 'waiting');
        if (runView) {
          runView.status.textContent = 'Waiting for you';
          runView.status.className = 'rs waiting';
        }
      } else {
        tlRow('commander', 'Run finished', ev.type, 'key');
        if (runView) runView.status.textContent = `Finished in ${secs} s`;
      }
      break;
    }
    case 'RUN_ERROR':
      tlRow('commander', `Run failed: ${ev.message ?? ev.code ?? 'unknown error'}`, ev.type, 'bad');
      if (runView) {
        runView.status.textContent = 'Failed';
        runView.status.className = 'rs error';
      }
      break;
    default: {
      const plain: Record<string, string> = {
        STATE_SNAPSHOT: 'State snapshot',
        STATE_DELTA: 'State change',
        MESSAGES_SNAPSHOT: 'Message history synced',
        STEP_STARTED: 'Step started',
        STEP_FINISHED: 'Step finished',
      };
      const s = ev.type.startsWith('REASONING') ? `${who} is reasoning` : plain[ev.type] ?? 'Other event';
      tlRow(a, s, ev.type, '', `other:${runNo}:${a}:${ev.type.replace(/_(START|CONTENT|END)$/, '')}`);
    }
  }
}

// ---------------------------------------------------------------- raw events
const DELTAS = new Set(['TEXT_MESSAGE_CONTENT', 'TOOL_CALL_ARGS', 'REASONING_MESSAGE_CONTENT']);
function rawFor(ev: any) {
  eventCount++;
  $('#count').textContent = String(eventCount);
  const row = el('details', `ev ${DELTAS.has(ev.type) ? 'delta' : ''}`);
  const sum = el('summary');
  const { type, timestamp, rawEvent, ...rest } = ev;
  const hint =
    ev.type === 'SUBAGENT_STARTED' ? ev.name :
    ev.type === 'TOOL_CALL_START' ? ev.toolCallName :
    ev.type === 'TEXT_MESSAGE_CONTENT' ? JSON.stringify(ev.delta) :
    ev.type === 'RUN_FINISHED' ? (ev.outcome?.type ?? 'success') :
    ev.type === 'CUSTOM' ? ev.name :
    ev.subagentRunId ? `in ${ev.subagentRunId}` : '';
  sum.append(el('span', 'ty', type));
  if (hint) sum.append(el('span', 'hint', String(hint).slice(0, 80)));
  row.append(sum, el('pre', '', JSON.stringify(rest, null, 2)));
  keepBottom(rawBox, () => rawList.append(row));
}

// ---------------------------------------------------------------- event reducer
function onEvent(ev: any) {
  rawFor(ev);
  reduce(ev);
  timelineFor(ev);
}

function reduce(ev: any) {
  switch (ev.type) {
    case 'RUN_STARTED':
      setStatus('running');
      break;
    case 'TOOL_CALL_START': {
      const name = ev.toolCallName as string;
      if (name.startsWith('agent-') && !ev.subagentRunId) byToolCall.set(ev.toolCallId, newDelegation(name.slice(6)));
      else newCall(ev);
      break;
    }
    case 'TOOL_CALL_ARGS': {
      const d = byToolCall.get(ev.toolCallId);
      if (d) {
        d.args += ev.delta;
        const p = parse(d.args);
        keepBottom(chat, () => markSent(d.sent, typeof p?.prompt === 'string' ? p.prompt : d.args));
        break;
      }
      const c = calls.get(ev.toolCallId);
      if (c) {
        c.args += ev.delta;
        const p = parse(c.args);
        c.argsEl.textContent = p ? fmtArgs(p) : '';
      }
      break;
    }
    case 'TOOL_CALL_RESULT': {
      const content = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content);
      const d = byToolCall.get(ev.toolCallId);
      if (d) {
        d.state.textContent = 'Answered';
        break;
      }
      const c = calls.get(ev.toolCallId);
      if (c) {
        const res = el('details', 'res');
        res.append(el('summary', '', 'Result'), el('pre', '', content.slice(0, 2000)));
        c.el.append(res);
      }
      break;
    }
    case 'SUBAGENT_STARTED': {
      const d = [...delegs].reverse().find((x) => x.agent === ev.name && !x.subRun);
      if (d) {
        d.subRun = ev.subagentRunId;
        d.state.textContent = 'Working';
      }
      subagents.set(ev.subagentRunId, { name: ev.name, deleg: d });
      break;
    }
    case 'SUBAGENT_FINISHED':
    case 'SUBAGENT_ERROR': {
      const d = subagents.get(ev.subagentRunId)?.deleg;
      if (d) d.state.textContent = ev.type === 'SUBAGENT_ERROR' ? 'Failed' : 'Finished';
      break;
    }
    case 'CUSTOM': {
      if (ev.name !== 'desk.specialistInput') break;
      const v = ev.value as SpecialistInput;
      const d = [...delegs].reverse().find((x) => x.agent === v.agent && !x.received);
      if (d) keepBottom(chat, () => showReceived(d, v));
      break;
    }
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_CONTENT': {
      let t = texts.get(ev.messageId);
      if (!t) {
        const d = ev.subagentRunId ? subagents.get(ev.subagentRunId)?.deleg : undefined;
        const a = agentOf(ev);
        const wrap = el('div', d ? `answer ${agentClass(a)}` : `msg assistant ${agentClass('commander')}`);
        const who = el('div', 'who');
        who.append(pin(), document.createTextNode(d ? `${a} answered` : 'Commander'));
        t = el('div');
        wrap.append(who, t);
        if (d) keepBottom(chat, () => d.el.append(wrap));
        else addToChat(wrap);
        texts.set(ev.messageId, t);
      }
      if (ev.delta) keepBottom(chat, () => (t!.textContent += ev.delta));
      break;
    }
    case 'RUN_FINISHED': {
      finishedRuns++;
      showUsage(ev.usage ?? []);
      const intrs = ev.outcome?.type === 'interrupt' ? ev.outcome.interrupts ?? [] : [];
      if (activeStep !== null) {
        // Mitigate counts as done once something was approved; after declines only, it stays the next step
        const st = steps[activeStep];
        const onlyDeclined = activeStep === 1 && st.decisions.length > 0 && !st.decisions.some((d) => d.startsWith('approved'));
        st.state = intrs.length ? 'waiting' : onlyDeclined ? 'todo' : 'done';
      }
      for (const intr of intrs) renderApproval(intr);
      setStatus(intrs.length ? 'waiting' : 'idle');
      renderSteps();
      break;
    }
    case 'RUN_ERROR':
      addToChat(el('div', 'error-msg', `The run failed: ${ev.message ?? ev.code ?? 'unknown error'}`));
      setStatus('error');
      if (activeStep !== null) steps[activeStep].state = 'todo';
      renderSteps();
      break;
  }
}

// ---------------------------------------------------------------- sending
function syncControls() {
  const locked = busy || pending > 0;
  for (const b of stepButtons) b.disabled = locked;
  sendBtn.disabled = locked;
  input.disabled = locked;
  input.placeholder = pending > 0 ? 'Decide on the approval request first' : 'Or type your own message to the commander';
}

async function run(params: any, label: string) {
  busy = true;
  runNo++;
  rowsByKey = new Map();
  startRunView(label);
  if (activeStep !== null) steps[activeStep].state = 'running';
  renderSteps();
  syncControls();
  try {
    await agent.runAgent(params, { onEvent: ({ event }: any) => onEvent(event) });
  } catch (e: any) {
    addToChat(el('div', 'error-msg', `The request failed: ${String(e?.message ?? e)}. Start a new thread and try again.`));
    setStatus('error');
    if (activeStep !== null && steps[activeStep].state === 'running') steps[activeStep].state = 'todo';
    renderSteps();
  } finally {
    busy = false;
    syncControls();
  }
}

async function sendText(text: string, label: string, step: number | null) {
  if (!text.trim() || busy || pending > 0) return;
  activeStep = step;
  const msg = el('div', 'msg user', text);
  addToChat(msg);
  agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
  await run({}, label);
}

// ---------------------------------------------------------------- wiring
function newThread() {
  threadId = `desk-${Date.now()}`;
  agent = new HttpAgent({ url: '/agui/incidentCommander', threadId });
  busy = false;
  pending = 0;
  activeStep = null;
  runNo = 0;
  finishedRuns = 0;
  eventCount = 0;
  steps = [0, 1, 2].map(() => ({ state: 'todo' as StepState, inputs: [], sentPII: false, delegatedTo: [], decisions: [] }));
  delegs = [];
  byToolCall = new Map();
  subagents = new Map();
  calls = new Map();
  texts = new Map();
  runView = undefined;
  rowsByKey = new Map();
  chat.replaceChildren();
  const empty = el('p', 'empty');
  empty.id = 'empty';
  empty.append(document.createTextNode('Start with '), el('b', '', 'Investigate'), document.createTextNode(" on the left. The commander's answers, its delegations and every approval request appear here."));
  chat.append(empty);
  timeline.replaceChildren(el('p', 'tl-empty', 'Each run appears here as a group, with one line per step and the event type next to it.'));
  rawList.replaceChildren();
  $('#count').textContent = '0';
  $('#usage').textContent = '';
  $('#thread').textContent = `Thread ${threadId}`;
  setStatus('idle');
  renderSteps();
  syncControls();
}

stepButtons.forEach((b, i) => (b.onclick = () => sendText(b.dataset.prompt!, ['Investigate', 'Mitigate', 'Follow-up'][i], i)));
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = input.value;
  input.value = '';
  sendText(t, 'Your message', null);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

const viewBtns = { timeline: $<HTMLButtonElement>('#view-timeline'), raw: $<HTMLButtonElement>('#view-raw') };
const setView = (v: 'timeline' | 'raw') => {
  viewBtns.timeline.setAttribute('aria-pressed', String(v === 'timeline'));
  viewBtns.raw.setAttribute('aria-pressed', String(v === 'raw'));
  timeline.hidden = v !== 'timeline';
  rawBox.hidden = v !== 'raw';
};
viewBtns.timeline.onclick = () => setView('timeline');
viewBtns.raw.onclick = () => setView('raw');
$<HTMLInputElement>('#showDeltas').onchange = (e) => rawBox.classList.toggle('show-deltas', (e.target as HTMLInputElement).checked);

const themeBtn = $('#theme');
const syncTheme = () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon'), el('span', '', dark ? 'Light' : 'Dark'));
};
themeBtn.onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('desk-theme', dark ? 'dark' : 'light');
  } catch {}
  syncTheme();
};
syncTheme();

initTabs({ resetChat: () => newThread() });
newThread();
fetch('/desk/info')
  .then((r) => r.json())
  .then((i) => {
    info = i;
    const b = $('#mode');
    b.textContent = i.mode === 'live' ? `Live model: ${i.models.large} and ${i.models.small}` : 'Mock model, scripted';
    b.className = `badge ${i.mode}`;
    renderRoster();
  })
  .catch(() => {
    $('#mode').textContent = 'Mode unknown';
    $('#roster').replaceChildren(el('p', 'roster-note', 'Could not load the agents. Is the server running?'));
  });
