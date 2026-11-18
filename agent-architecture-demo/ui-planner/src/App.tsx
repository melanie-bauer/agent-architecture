import { CopilotKit, useCopilotChatInternal } from '@copilotkit/react-core';
import { AssistantMessage, CopilotChat } from '@copilotkit/react-ui';
import { Role, TextMessage } from '@copilotkit/runtime-client-gql';
import '@copilotkit/react-ui/styles.css';
import { CalendarDays, MessageSquarePlus, DoorOpen, LayoutDashboard, PanelRightClose, PanelRightOpen, Plane, RotateCcw, Users, UtensilsCrossed, Wallet, Waypoints } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchPlans, progress, useBase, type Plan, type Plans } from './api';
import { emptyNet, emptyNets, isIdle, MODES, reduceAll, type Mode, type NetState, type RequestKind, type VizEvent } from './network';
import { ApprovalCard, runApproval } from './approval';
import { ENTRY, kindOf, REQUESTS } from './requests';
import { NetworkScreen, type Run, type RunStatus } from './screens/NetworkScreen';
import { Overview } from './screens/Overview';
import { Budget, Catering, Program, Rooms, Speakers, Travel } from './screens/DataScreens';
import { LABEL } from './network';
import { MODE_NAME, MODE_TITLE, modeHint, RunContext } from './ui';

const SCREENS = [
  { id: 'overview', name: 'Overview', icon: LayoutDashboard },
  { id: 'program', name: 'Program', icon: CalendarDays },
  { id: 'speakers', name: 'Speakers', icon: Users },
  { id: 'rooms', name: 'Rooms', icon: DoorOpen },
  { id: 'catering', name: 'Catering', icon: UtensilsCrossed },
  { id: 'travel', name: 'Travel', icon: Plane },
  { id: 'budget', name: 'Budget', icon: Wallet },
  { id: 'network', name: 'Network', icon: Waypoints },
] as const;
type ScreenId = (typeof SCREENS)[number]['id'];

const screenFromHash = (): ScreenId => {
  const h = location.hash.replace(/^#\/?/, '');
  return (SCREENS.find((s) => s.id === h)?.id ?? 'overview') as ScreenId;
};
const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

type ChatHandle = { send: (text: string) => Promise<void>; answer: () => string };
/** A request that was sent and has not finished yet: its numbers land in Compare runs when it ends. */
type Armed = { kind: RequestKind; at: number; sawLoading: boolean; loadEnd?: number; failed?: string };
const LIMIT = /(Message budget|Max conversation depth)[^"\\]*/i;

/** What one finished run did, from the map state, the plan and the chat. */
function finishRun(m: Mode, a: Armed, n: NetState, p: Plan | undefined, answer: string): Run {
  const entries = n.turns.flatMap((t) => t.entries);
  const writes = entries.filter((e) => e.kind === 'write').length;
  const limit = entries.map((e) => JSON.stringify(e.result ?? e.reply ?? '').match(LIMIT)?.[0]).find(Boolean);
  const pr = p ? progress(p) : { done: 0, already: 0, of: 0, parts: {} };
  const end = Math.max(n.lastAt ?? 0, a.loadEnd ?? 0);
  const seconds = n.startedAt && n.lastAt ? (n.lastAt - n.startedAt) / 1000 : (end - a.at) / 1000;
  const status: RunStatus = a.failed || (!answer && n.llmCalls === 0) ? 'failed' : limit ? 'limit' : writes === 0 ? 'no-writes' : 'completed';
  return {
    id: `${m}-${a.at}`,
    mode: m,
    request: a.kind,
    seconds: Math.max(0, seconds),
    llm: n.llmCalls,
    tools: n.tools,
    messages: n.messages,
    tokens: n.tokens,
    done: pr.done,
    already: pr.already,
    of: pr.of,
    parts: pr.parts,
    status,
    answer,
    note: a.failed ?? limit,
    seenBy: p?.passportSeenBy ?? [],
    approvals: (p?.approvals ?? []).filter((x) => p?.run && x.run === p.run.id).map((x) => x.id),
    at: Date.now(),
  };
}

export function App() {
  const { base, error } = useBase();
  const [mode, setMode] = useState<Mode>('single');
  // each mode keeps its own screen, chat, map, activity log and counters
  const [screens, setScreens] = useState<Record<Mode, ScreenId>>(() => ({ single: screenFromHash(), centralized: 'overview', decentralized: 'overview' }));
  const [nets, setNets] = useState<Record<Mode, NetState>>(emptyNets);
  const [loading, setLoading] = useState<Record<Mode, boolean>>({ single: false, centralized: false, decentralized: false });
  const [epoch, setEpoch] = useState(0); // a new epoch remounts the chats (Reset)
  const [chatEpoch, setChatEpoch] = useState<Record<Mode, number>>({ single: 0, centralized: 0, decentralized: 0 }); // New chat, per setup
  const [plans, setPlans] = useState<Plans | null>(null);
  const [info, setInfo] = useState<{ demo?: string; transport?: string; effort?: string; models?: { large: string; small: string } }>({});
  // finished runs survive a page reload (this browser tab only); Reset clears them
  const [runs, setRuns] = useState<Run[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('planner-runs') ?? '[]');
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem('planner-runs', JSON.stringify(runs));
    } catch {
      /* storage blocked: runs live in memory only */
    }
  }, [runs]);
  const [dockOpen, setDockOpen] = useState(() => window.innerWidth > 1440);
  const [, tick] = useState(0);
  const screen = screens[mode];
  const netsRef = useRef(nets);
  netsRef.current = nets;
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const chats = useRef<Partial<Record<Mode, ChatHandle>>>({});
  const lastScreen = useRef<Record<Mode, ScreenId>>({ single: 'overview', centralized: 'overview', decentralized: 'overview' });

  // ---------- live data: plan snapshots + network events ----------
  const refetch = useRef<number | undefined>(undefined);
  const loadPlans = useCallback(() => {
    clearTimeout(refetch.current);
    refetch.current = window.setTimeout(() => fetchPlans().then(setPlans).catch(() => {}), 80);
  }, []);
  useEffect(() => {
    fetch('/planner/info', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => setInfo({ demo: p.mode, transport: p.transport, effort: p.reasoningEffort, models: p.models }))
      .catch(() => {});
    loadPlans();
    const es = new EventSource('/planner/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as VizEvent;
      if (e.type === 'plan' || e.type === 'reset') loadPlans();
      // every event belongs to one mode: it changes only that mode's map and log
      setNets((s) => reduceAll(s, e));
    };
    es.onopen = loadPlans;
    return () => es.close();
  }, [loadPlans]);

  // fresh highlights fade on a clock, not only when data arrives
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const setScreen = useCallback((s: ScreenId) => setScreens((x) => ({ ...x, [modeRef.current]: s })), []);
  useEffect(() => {
    const on = () => setScreen(screenFromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, [setScreen]);
  useEffect(() => {
    if (screenFromHash() !== screen) history.replaceState(null, '', `#/${screen}`);
  }, [screen]);

  // the network map needs the width: the assistant folds away on the Network screen and comes back after
  const dockBefore = useRef<boolean | null>(null);
  useEffect(() => {
    if (screen === 'network' && dockBefore.current === null) {
      dockBefore.current = dockOpen;
      setDockOpen(false);
    } else if (screen !== 'network' && dockBefore.current !== null) {
      setDockOpen(dockBefore.current);
      dockBefore.current = null;
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (s: ScreenId) => {
    if (s !== 'network') lastScreen.current[modeRef.current] = s;
    location.hash = `/${s}`;
    setScreen(s);
  };

  // a run is finished when the assistant has answered, nothing has happened for 1.5 s and nobody is thinking:
  // keep its numbers for "Compare runs"
  const armed = useRef<Partial<Record<Mode, Armed>>>({});
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  useEffect(() => {
    const t = setInterval(() => {
      for (const m of MODES) {
        const a = armed.current[m];
        if (!a) continue;
        const n = netsRef.current[m];
        if (loadingRef.current[m] || !isIdle(n)) continue;
        if (!a.sawLoading && !a.failed && Date.now() - a.at < 4000) continue; // the request has not started yet
        if (Date.now() - Math.max(n.lastAt ?? 0, a.loadEnd ?? 0) < 1500) continue;
        armed.current[m] = undefined;
        const run = finishRun(m, a, n, plansRef.current?.[m], chats.current[m]?.answer() ?? '');
        setRuns((r) => [...r, run]);
      }
    }, 500);
    return () => clearInterval(t);
  }, []);

  const switchMode = (m: Mode) => {
    if (m === modeRef.current) return;
    setMode(m);
    modeRef.current = m;
    // nothing is reset: each mode shows exactly what it showed when you left it
  };
  const resetAll = () => {
    armed.current = {};
    setNets(emptyNets());
    setRuns([]);
    chats.current = {};
    setEpoch((e) => e + 1);
    post('/planner/reset', { scope: 'all' });
  };
  // a new request starts a run: the map and counters of this setup start fresh, the plan is kept (only Reset clears it)
  const beforeRun = useCallback(async (kind: RequestKind) => {
    const m = modeRef.current;
    armed.current[m] = { kind, at: Date.now(), sawLoading: false };
    setNets((s) => ({ ...s, [m]: emptyNet(kind) }));
    await post('/planner/run', { mode: m, request: kind });
  }, []);

  const net = nets[mode];
  const working = Object.values(net.nodes).filter((n) => n.busy > 0).length;
  const running = working > 0 || loading[mode];
  const runCtx = useMemo(
    () => ({
      running,
      run: async (kind: RequestKind) => {
        if (running) return;
        await beforeRun(kind);
        await chats.current[modeRef.current]?.send(REQUESTS[kind].text);
      },
      // after a declined booking: a new run of the same request in the same setup (the declined card stays in the plan)
      followUp: async (text: string) => {
        const m = modeRef.current;
        await beforeRun(plansRef.current?.[m]?.request ?? 'travelUs');
        await chats.current[m]?.send(text);
      },
    }),
    [running, beforeRun],
  );
  const plan = plans?.[mode] ?? null;
  // a new conversation in this setup: its chat thread and map start fresh, the plan stays (only Reset clears it)
  const newChat = () => {
    const m = modeRef.current;
    armed.current[m] = undefined;
    delete chats.current[m];
    setNets((s) => ({ ...s, [m]: emptyNet() }));
    setChatEpoch((x) => ({ ...x, [m]: x[m] + 1 }));
  };
  const onLoading = useCallback((m: Mode, v: boolean) => {
    const a = armed.current[m];
    if (a && v) a.sawLoading = true;
    if (a && !v && a.sawLoading) a.loadEnd = Date.now();
    setLoading((x) => (x[m] === v ? x : { ...x, [m]: v }));
  }, []);
  const onFailed = useCallback((m: Mode, error: string) => {
    const a = armed.current[m];
    if (a) a.failed = error;
  }, []);
  const onReady = useCallback((m: Mode, h: ChatHandle) => (chats.current[m] = h), []);

  return (
    <RunContext.Provider value={runCtx}>
      <div className={`app ${dockOpen ? 'dock-open' : 'dock-closed'}`}>
        <header className="topbar">
          <div className="brand">
            <div>
              <strong>{base?.event.name ?? 'VibeKode 2027'}</strong>
              <span>{base ? `${base.event.city}, ${base.event.dates.replace('–', ' to ')}` : 'Planner'}</span>
            </div>
          </div>
          <div className="modes" role="group" aria-label="Agent setup">
            {MODES.map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} aria-pressed={m === mode} title={modeHint(m, nets[m].request)} onClick={() => switchMode(m)}>
                {MODE_NAME[m]}
                {Object.values(nets[m].nodes).some((n) => n.busy > 0) || loading[m] ? <i className="mode-busy" aria-label="working" /> : null}
              </button>
            ))}
          </div>
          <div className={`status ${working ? 'busy' : ''}`} aria-live="polite">
            <i aria-hidden="true" />
            {working ? `${working} ${working === 1 ? 'agent' : 'agents'} working` : 'Idle'}
          </div>
          <div className="topbar-end">
            {mode !== 'single' && info.transport && <span className={`badge ${info.transport}`}>{info.transport === 'a2a' ? 'A2A over HTTP' : 'In process'}</span>}
            {info.demo && <span className={`badge ${info.demo}`}>{info.demo === 'live' ? 'Live model' : <>Mock<span className="btn-text"> model, scripted</span></>}</span>}
            <button className={`btn ${screen === 'network' ? 'on' : ''}`} aria-pressed={screen === 'network'} aria-label="Network" onClick={() => go(screen === 'network' ? lastScreen.current[mode] : 'network')}>
              <Waypoints aria-hidden="true" />
              <span className="btn-text">Network</span>
            </button>
            <button className="btn" onClick={resetAll} aria-label="Reset" title="Clear every plan, chat, map and run counter">
              <RotateCcw aria-hidden="true" />
              <span className="btn-text">Reset</span>
            </button>
          </div>
        </header>

        <nav className="sidenav" aria-label="Screens">
          {SCREENS.map((s) => (
            <a key={s.id} href={`#/${s.id}`} className={s.id === screen ? 'on' : ''} aria-current={s.id === screen ? 'page' : undefined} onClick={(e) => (e.preventDefault(), go(s.id))}>
              <s.icon aria-hidden="true" />
              {s.name}
            </a>
          ))}
          <div className="nav-foot">
            <p>
              Plan written by <b>{MODE_TITLE[mode]}</b>
            </p>
            <ModeProgress plans={plans} mode={mode} />
          </div>
        </nav>

        <main className="main" id="main">
          {error && <div className="callout problem">Could not load the base data: {error}. Is the backend running on port 4111?</div>}
          {!base || !plan ? (
            <p className="loading">Loading the plan…</p>
          ) : screen === 'overview' ? (
            <Overview base={base} plan={plan} mode={mode} go={go} />
          ) : screen === 'program' ? (
            <Program base={base} plan={plan} />
          ) : screen === 'speakers' ? (
            <Speakers base={base} plan={plan} />
          ) : screen === 'rooms' ? (
            <Rooms base={base} plan={plan} />
          ) : screen === 'catering' ? (
            <Catering base={base} plan={plan} />
          ) : screen === 'travel' ? (
            <Travel base={base} plan={plan} mode={mode} />
          ) : screen === 'budget' ? (
            <Budget base={base} plan={plan} mode={mode} />
          ) : (
            <NetworkScreen mode={mode} net={net} plan={plan} plans={plans!} runs={runs} live={info.demo === 'live'} info={info} />
          )}
        </main>

        <aside className="dock" aria-label="Assistant">
          {dockOpen ? (
            <div className="dock-head">
              <div>
                <h2>Assistant</h2>
                <p>
                  {MODE_TITLE[mode]}. {modeHint(mode, net.request)}
                </p>
              </div>
              <div className="head-actions">
                <button className="btn sm" onClick={newChat} disabled={running} title="Start a new conversation in this setup. The plan stays; Reset clears everything.">
                  <MessageSquarePlus aria-hidden="true" />
                  New chat
                </button>
                <button className="icon-btn" onClick={() => setDockOpen(false)} aria-label="Collapse the assistant">
                  <PanelRightClose aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <button className="dock-rail" onClick={() => setDockOpen(true)} aria-label="Open the assistant">
              <PanelRightOpen aria-hidden="true" />
              <span>Assistant</span>
              {plan?.approvals.some((x) => x.status === 'pending') && <span className="rail-approval">Approval waits</span>}
            </button>
          )}
          {/* one CopilotKit agent per mode, all mounted: a mode keeps its conversation (and a running request) while another mode is on screen */}
          {MODES.map((m) => (
            <div key={`${m}-${epoch}-${chatEpoch[m]}`} className="mode-chat" hidden={!dockOpen || m !== mode}>
              <CopilotKit runtimeUrl="/copilotkit" agent={m} showDevConsole={false}>
                <ChatPlan.Provider value={plans?.[m] ?? null}>
                  <ModeChat mode={m} eventName={base?.event.name} beforeRun={beforeRun} onReady={onReady} onLoading={onLoading} onFailed={onFailed} />
                </ChatPlan.Provider>
              </CopilotKit>
            </div>
          ))}
        </aside>
      </div>
    </RunContext.Provider>
  );
}

/** The plan of the chat's own setup, for the approval card that shows inside the conversation. */
const ChatPlan = createContext<Plan | null>(null);

/**
 * An assistant answer. Under the last answer of a run that proposed a booking, the approval card follows as part of the conversation:
 * it never covers a message, and it scrolls with the chat.
 */
function ChatAnswer(props: any) {
  const plan = useContext(ChatPlan);
  const last = [...(props.messages ?? [])].reverse().find((x: any) => x.role === 'assistant');
  const a = runApproval(plan);
  const show = !!plan && !!a && !props.isLoading && last?.id === props.message?.id;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (show) ref.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [show, a?.id]);
  return (
    <>
      <AssistantMessage {...props} />
      {show && (
        <div className="chat-card" ref={ref}>
          <ApprovalCard plan={plan!} approval={a} compact />
        </div>
      )}
    </>
  );
}

/** The chat of one mode. It stays mounted while another mode is on screen, so its conversation is kept. */
function ModeChat({ mode, eventName, beforeRun, onReady, onLoading, onFailed }: { mode: Mode; eventName?: string; beforeRun: (k: RequestKind) => Promise<void>; onReady: (m: Mode, h: ChatHandle) => void; onLoading: (m: Mode, v: boolean) => void; onFailed: (m: Mode, error: string) => void }) {
  const chat = useCopilotChatInternal();
  const append = chat.appendMessage;
  const messages = useRef(chat.messages);
  messages.current = chat.messages;
  useEffect(() => {
    onReady(mode, {
      send: async (text) => {
        try {
          await append(new TextMessage({ role: Role.User, content: text }));
        } catch (e: any) {
          onFailed(mode, String(e?.message ?? e).slice(0, 200));
        }
      },
      // the final answer of the run: the last message, when it is the assistant's
      answer: () => {
        const last = ((messages.current ?? []) as any[]).at(-1);
        return last?.role === 'assistant' && typeof last.content === 'string' ? last.content : '';
      },
    });
  }, [mode, append, onReady, onFailed]);
  useEffect(() => onLoading(mode, chat.isLoading), [mode, chat.isLoading, onLoading]);
  useEffect(() => () => onLoading(mode, false), [mode, onLoading]);
  return (
    <CopilotChat
      className="chat"
      labels={{
        title: 'Assistant',
        initial: `${MODE_TITLE[mode]}. Ask it to assign rooms for ${eventName ?? 'the conference'} or to book the US speakers. The plan fills in on the left as the agents work.`,
        placeholder: 'Ask the planner…',
      }}
      AssistantMessage={ChatAnswer}
      suggestions={[
        { title: REQUESTS.rooms.title, message: REQUESTS.rooms.text },
        { title: REQUESTS.travelUs.title, message: REQUESTS.travelUs.text },
      ]}
      // a typed follow-up about a declined booking keeps the plan; anything else starts a new request
      onSubmitMessage={(text: string) => (/^the booking was declined/i.test(text.trim()) ? undefined : beforeRun(kindOf(text)))}
    />
  );
}

function ModeProgress({ plans, mode }: { plans: Plans | null; mode: Mode }) {
  if (!plans) return null;
  return (
    <ul className="mode-progress" aria-label="Plans per setup">
      {MODES.map((m) => {
        const p = plans[m];
        const pr = progress(p);
        return (
          <li key={m} className={m === mode ? 'on' : ''}>
            <span>{MODE_NAME[m]}</span>
            <span className="num">{p.changes.length === 0 ? 'empty' : p.inPlan.all ? 'complete' : `${pr.done + pr.already} of ${pr.of}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
