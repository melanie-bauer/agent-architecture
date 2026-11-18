// Helpers shared by the three tabs (Chat, Workflow, Visualization).

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  pause: '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
};

export const icon = (name: string) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
};

export const pin = () => el('span', 'pin');

export const nearBottom = (box: HTMLElement) => box.scrollHeight - box.scrollTop - box.clientHeight < 120;
export const keepBottom = (box: HTMLElement, fn: () => void) => {
  const stick = nearBottom(box);
  fn();
  if (stick) box.scrollTop = box.scrollHeight;
};

export const fmtArgs = (a: Record<string, unknown>) =>
  Object.entries(a)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');

export const parse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

export const listNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Writes text into box and marks customer data (name, email, card) red. Returns whether any was found. */
export function markSent(box: HTMLElement, text: string) {
  box.replaceChildren();
  const re = /([\w.+-]+@[\w-]+\.[\w.]+)|(card ending \d{4})|((?<=[Cc]ustomer\s+)[A-Z][a-z]+\s+[A-Z][a-z]+)/g;
  let last = 0;
  let found = false;
  for (const m of text.matchAll(re)) {
    box.append(document.createTextNode(text.slice(last, m.index)));
    box.append(el('mark', 'pii', m[0]));
    last = m.index! + m[0].length;
    found = true;
  }
  box.append(document.createTextNode(text.slice(last)));
  return found;
}

/** Writes text into box and marks the redaction placeholders green. */
export function markReceived(box: HTMLElement, text: string) {
  box.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(/\[(email|card|name)\]/g)) {
    box.append(document.createTextNode(text.slice(last, m.index)));
    box.append(el('mark', 'redacted', m[0]));
    last = m.index! + m[0].length;
  }
  box.append(document.createTextNode(text.slice(last)));
}

// ---------------------------------------------------------------- top bar status, one per tab
export type Tab = 'chat' | 'workflow' | 'viz';
export type RunState = 'idle' | 'running' | 'waiting' | 'error';
const STATUS_TEXT: Record<RunState, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Waiting for your decision. Nothing is running.',
  error: 'Error',
};
const states: Record<Tab, RunState> = { chat: 'idle', workflow: 'idle', viz: 'idle' };
let current: Tab = 'chat';

function paintStatus() {
  const s = $('#status');
  const st = states[current];
  s.dataset.state = st;
  s.hidden = current === 'viz';
  $('#status-text').textContent = STATUS_TEXT[st];
}
export const setStatus = (tab: Tab, st: RunState) => {
  states[tab] = st;
  if (tab === current) paintStatus();
};
export const showTabStatus = (tab: Tab) => {
  current = tab;
  paintStatus();
};

/** Reads an AG-UI SSE response and calls onEvent per event. */
export async function readSse(res: Response, onEvent: (e: any) => void) {
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      const ev = data && parse(data);
      if (ev) onEvent(ev);
    }
  }
}
