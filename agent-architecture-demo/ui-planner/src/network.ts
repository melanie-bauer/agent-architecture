// Turns the server's visualisation events into a graph state the map can draw, and an activity log grouped by agent turn.
// Every event carries the mode of the agent that caused it; the app keeps one state per mode (see App.tsx).
export type Mode = 'single' | 'centralized' | 'decentralized';
export const MODES: Mode[] = ['single', 'centralized', 'decentralized'];
export const DOMAINS = ['program', 'venue', 'access', 'catering', 'budget', 'marketing', 'travel'] as const;
export type Domain = (typeof DOMAINS)[number];
/** open: what a person typed into the chat (no fixed brief; decentralized: a router picks the entry peer) */
export type RequestKind = 'rooms' | 'travelUs' | 'conference' | 'travel' | 'open';
export const REQUEST_KINDS: RequestKind[] = ['rooms', 'travelUs', 'conference', 'travel', 'open'];

export const LABEL: Record<string, string> = {
  program: 'Program',
  venue: 'Venue',
  access: 'Accessibility',
  catering: 'Catering',
  budget: 'Budget',
  marketing: 'Marketing',
  travel: 'Travel',
  triage: 'Triage',
  router: 'Router',
  single: 'Planner',
  board: 'Plan board',
  person: 'A person',
};

// which domain owns a tool (used in single-agent mode to draw where the agent reaches)
export const TOOL_DOMAIN: Record<string, Domain> = {
  listSubmissions: 'program', shortlistTalks: 'program', draftSchedule: 'program', placeTalks: 'program',
  listRooms: 'venue', checkAvailability: 'venue', quoteVenue: 'venue', assignRooms: 'venue', dropRoom: 'venue',
  listCaterers: 'catering', dietaryStats: 'catering', quoteCatering: 'catering', chooseCaterer: 'catering',
  listInternationalSpeakers: 'travel', quoteTravel: 'travel', bookTravel: 'travel', lastProposal: 'travel',
  readPassports: 'travel', recordVisaChecks: 'travel', quoteFlights: 'travel', bookFlights: 'travel', quoteHotel: 'travel', bookHotel: 'travel',
  getBudget: 'budget', checkPlan: 'budget', recordBudgetCheck: 'budget',
  ticketForecast: 'marketing', sponsorPipeline: 'marketing',
  checkRoomAccess: 'access', quoteCaptioning: 'access', markRooms: 'access', bookCaptions: 'access',
};
export const WRITE_TOOLS = new Set(['placeTalks', 'assignRooms', 'dropRoom', 'chooseCaterer', 'bookTravel', 'recordVisaChecks', 'bookFlights', 'bookHotel', 'recordBudgetCheck', 'markRooms', 'bookCaptions', 'flagRisk']);

export type VizEvent = {
  t: number;
  type: string;
  mode?: Mode;
  scope?: string;
  request?: string;
  call?: string;
  tokens?: number;
  ms?: number;
  sawPassport?: boolean;
  agent?: string;
  tool?: string;
  args?: unknown;
  summary?: string;
  result?: unknown;
  system?: string;
  from?: string;
  to?: string;
  text?: string;
  via?: string;
  id?: string;
  redacted?: number;
  task?: { id: string; contextId?: string; state: string };
  status?: string;
  totalEur?: number;
  by?: string;
  reason?: string;
  section?: string;
  note?: string;
};

export type NodeState = { busy: number; calls: number; modelMs: number; tools: Record<string, number>; lastTool?: string; lastAt?: number; spoke: boolean; sawPassport: boolean };
export type EdgeState = { from: string; to: string; kind: 'a2a' | 'delegation' | 'local' | 'tool' | 'board'; live: number; count: number; lastAt: number };
/** One thing an agent did: a tool call (read or write), a message to another agent, or a board post. */
export type Entry = {
  id: string;
  kind: 'read' | 'write' | 'message' | 'board' | 'decision';
  agent: string;
  t: number;
  tool?: string;
  args?: unknown;
  result?: unknown;
  system?: string;
  to?: string;
  via?: string;
  text?: string;
  reply?: string;
  redacted?: number;
  ms?: number;
  /** the A2A task the answer came in (decentralized peers) */
  task?: { id: string; contextId?: string; state: string };
  pending: boolean;
};
/** One model call of one agent and what it did right after: the tool calls and messages that call decided on. */
export type Turn = { id: string; agent: string; step: number; t: number; modelMs?: number; tokens?: number; sawPassport?: boolean; entries: Entry[] };
export type NetState = {
  nodes: Record<string, NodeState>;
  edges: Record<string, EdgeState>;
  turns: Turn[];
  open: Record<string, number>; // agent -> index of its current turn
  where: Record<string, [number, number]>; // entry id -> [turn, entry]
  board: { agent: string; section: string; note: string }[];
  tools: number;
  messages: number;
  llmCalls: number;
  tokens: number;
  systemMs: number;
  pending: number; // tool calls and messages still waiting for a result
  request?: RequestKind;
  startedAt?: number;
  lastAt?: number;
};

export const emptyNet = (request?: RequestKind): NetState => ({ nodes: {}, edges: {}, turns: [], open: {}, where: {}, board: [], tools: 0, messages: 0, llmCalls: 0, tokens: 0, systemMs: 0, pending: 0, request });
export const emptyNets = (): Record<Mode, NetState> => ({ single: emptyNet(), centralized: emptyNet(), decentralized: emptyNet() });

const blankNode = (): NodeState => ({ busy: 0, calls: 0, modelMs: 0, tools: {}, spoke: false, sawPassport: false });
const edge = (s: NetState, from: string, to: string, kind: EdgeState['kind']) => s.edges[`${from}>${to}`] ?? { from, to, kind, live: 0, count: 0, lastAt: 0 };

/** Apply every event to the state of the mode it belongs to. */
export function reduceAll(nets: Record<Mode, NetState>, e: VizEvent): Record<Mode, NetState> {
  if (e.type === 'reset') {
    if (e.scope === 'all') return emptyNets();
    if (e.scope === 'run' && e.mode && e.mode in nets) return { ...nets, [e.mode]: emptyNet(REQUEST_KINDS.includes(e.request as RequestKind) ? (e.request as RequestKind) : 'conference') };
    return nets;
  }
  if (e.type === 'plan' || !e.mode || !(e.mode in nets)) return nets;
  return { ...nets, [e.mode]: reduce(nets[e.mode], e, e.mode) };
}

export function reduce(prev: NetState, e: VizEvent, mode: Mode): NetState {
  const s: NetState = { ...prev, nodes: { ...prev.nodes }, edges: { ...prev.edges } };
  // a person's decision comes after the run: it does not stretch the run's time
  if (e.type !== 'approval') {
    s.startedAt ??= e.t;
    s.lastAt = e.t;
  }
  const touch = (id: string) => (s.nodes[id] = { ...(s.nodes[id] ?? blankNode()) });
  const turnOf = (agent: string) => {
    if (s.open[agent] === undefined) {
      s.turns = [...s.turns, { id: `${agent}-${e.t}`, agent, step: (s.nodes[agent]?.calls ?? 0) || 1, t: e.t, entries: [] }];
      s.open = { ...s.open, [agent]: s.turns.length - 1 };
    }
    return s.open[agent];
  };
  const addEntry = (agent: string, entry: Entry) => {
    const ti = turnOf(agent);
    if (s.turns === prev.turns) s.turns = [...s.turns];
    const turn = { ...s.turns[ti], entries: [...s.turns[ti].entries, entry] };
    s.turns[ti] = turn;
    s.where = { ...s.where, [entry.id]: [ti, turn.entries.length - 1] };
  };
  const patchEntry = (id: string | undefined, patch: Partial<Entry>) => {
    const w = id ? s.where[id] : undefined;
    if (!w) return;
    const [ti, ei] = w;
    if (s.turns === prev.turns) s.turns = [...s.turns];
    const entries = [...s.turns[ti].entries];
    entries[ei] = { ...entries[ei], ...patch };
    s.turns[ti] = { ...s.turns[ti], entries };
  };
  const reach = (domain: string, tool: string) => {
    // single agent: draw where in the domains the one agent reaches
    const ed = (s.edges[`single>${domain}`] = { ...edge(s, 'single', domain, 'tool') });
    ed.count++;
    ed.lastAt = e.t;
    const dn = touch(domain);
    dn.tools = { ...dn.tools, [tool]: (dn.tools[tool] ?? 0) + 1 };
    dn.lastAt = e.t;
    dn.lastTool = tool;
  };

  switch (e.type) {
    case 'agent-start': {
      const n = touch(e.agent!);
      n.busy += 1;
      n.spoke = true;
      s.llmCalls++;
      break;
    }
    case 'agent-end': {
      const n = touch(e.agent!);
      n.busy = Math.max(0, n.busy - 1);
      n.calls += 1;
      n.modelMs += e.ms ?? 0;
      if (e.sawPassport) n.sawPassport = true;
      s.tokens += e.tokens ?? 0;
      // a new turn starts: whatever this agent does next was decided by this model call
      s.turns = [...s.turns, { id: e.call ?? `${e.agent}-${e.t}`, agent: e.agent!, step: n.calls, t: e.t, modelMs: e.ms, tokens: e.tokens, sawPassport: !!e.sawPassport, entries: [] }];
      s.open = { ...s.open, [e.agent!]: s.turns.length - 1 };
      break;
    }
    case 'tool': {
      const n = touch(e.agent!);
      n.tools = { ...n.tools, [e.tool!]: (n.tools[e.tool!] ?? 0) + 1 };
      n.lastTool = e.tool;
      n.lastAt = e.t;
      s.tools++;
      if (e.tool === 'readBoard') {
        const ed = (s.edges[`board>${e.agent}`] = { ...edge(s, 'board', e.agent!, 'board') });
        ed.count++;
        ed.lastAt = e.t;
      } else if (mode === 'single') {
        const d = TOOL_DOMAIN[e.tool!] ?? ((e.args as any)?.domain as Domain | undefined);
        if (d) reach(d, e.tool!);
      }
      s.pending++;
      addEntry(e.agent!, { id: e.id!, kind: WRITE_TOOLS.has(e.tool!) ? 'write' : 'read', agent: e.agent!, t: e.t, tool: e.tool, args: e.args, pending: true });
      break;
    }
    case 'tool-result': {
      s.pending = Math.max(0, s.pending - 1);
      patchEntry(e.id, { result: e.result, ms: e.ms, system: e.system, pending: false });
      if (e.system) s.systemMs += e.ms ?? 0;
      break;
    }
    case 'message': {
      const kind = e.via === 'a2a' ? 'a2a' : e.via === 'local' ? 'local' : 'delegation';
      const ed = (s.edges[`${e.from}>${e.to}`] = { ...edge(s, e.from!, e.to!, kind as EdgeState['kind']) });
      ed.live++;
      ed.count++;
      ed.lastAt = e.t;
      // the router hands the request on: no conversation between agents, so it does not count as an agent message
      if (e.from !== 'router') s.messages++;
      s.pending++;
      touch(e.from!);
      addEntry(e.from!, { id: e.id!, kind: 'message', agent: e.from!, to: e.to, via: kind, t: e.t, text: e.text, pending: true });
      break;
    }
    case 'approval': {
      // a person decides outside the agents: the decision lands in the log as its own turn
      const text = e.status === 'pending' ? `A booking of €${(e.totalEur ?? 0).toLocaleString('en-US')} waits for a person` : e.status === 'approved' ? `${e.by ?? 'A person'} approved the booking of €${(e.totalEur ?? 0).toLocaleString('en-US')}` : e.status === 'declined' ? `${e.by ?? 'A person'} declined the booking of €${(e.totalEur ?? 0).toLocaleString('en-US')}: ${e.reason ?? ''}` : `Booking ${e.status}`;
      s.turns = [...s.turns, { id: `person-${e.id}-${e.status}-${e.t}`, agent: 'person', step: 0, t: e.t, entries: [{ id: `ap-${e.id}-${e.status}-${e.t}`, kind: 'decision', agent: 'person', t: e.t, text, args: { status: e.status }, pending: false }] }];
      s.open = { ...s.open, person: undefined as any };
      delete (s.open as any).person;
      break;
    }
    case 'reply': {
      const key = `${e.to}>${e.from}`;
      if (s.edges[key]) s.edges[key] = { ...s.edges[key], live: Math.max(0, s.edges[key].live - 1), lastAt: e.t };
      s.pending = Math.max(0, s.pending - 1);
      patchEntry(e.id, { reply: e.text, ms: e.ms, redacted: e.redacted, task: e.task, pending: false });
      break;
    }
    case 'board': {
      const ed = (s.edges[`${e.agent}>board`] = { ...edge(s, e.agent!, 'board', 'board') });
      ed.count++;
      ed.lastAt = e.t;
      s.board = [...s.board, { agent: e.agent!, section: e.section!, note: e.note! }];
      addEntry(e.agent!, { id: `b-${e.t}-${s.board.length}`, kind: 'board', agent: e.agent!, t: e.t, text: e.note, args: { section: e.section }, pending: false });
      break;
    }
  }
  return s;
}

/** Nothing has happened for a while and nobody is thinking. */
export const isIdle = (n: NetState) => n.pending === 0 && Object.values(n.nodes).every((x) => x.busy === 0);
