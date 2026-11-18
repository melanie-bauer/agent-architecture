import { ChevronRight, ShieldCheck, X } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { clock, eur, PART_NAME, progress, type PartState, type Plan, type Plans } from '../api';
import { NetworkMap } from '../NetworkMap';
import { LABEL, type Entry, type Mode, type NetState, type RequestKind, type Turn } from '../network';
import { ENTRY, REQUESTS } from '../requests';
import { replyLine, sentence } from '../sentences';
import { MODE_NAME, MODE_TITLE, modeHint, Segmented } from '../ui';

/** How a run ended: it wrote what it did, it answered without writing anything, it broke, or a guard rail stopped it. */
export type RunStatus = 'completed' | 'no-writes' | 'failed' | 'limit';
export type Run = {
  id: string;
  mode: Mode;
  request: RequestKind;
  seconds: number;
  llm: number;
  tools: number;
  messages: number;
  tokens: number;
  /** plan parts this run wrote or confirmed */
  done: number;
  /** plan parts an earlier run wrote */
  already: number;
  of: number;
  parts: Record<string, PartState>;
  status: RunStatus;
  answer: string;
  note?: string;
  seenBy: string[];
  approvals: string[];
  at: number;
};
type Info = { demo?: string; effort?: string; models?: { large: string; small: string } };
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const secs = (n: NetState) => (n.startedAt && n.lastAt ? (n.lastAt - n.startedAt) / 1000 : 0);
const AGENTS: Record<Mode, string[]> = {
  single: ['single'],
  centralized: ['triage', 'program', 'venue', 'access', 'catering', 'budget', 'marketing', 'travel'],
  decentralized: ['program', 'venue', 'access', 'catering', 'budget', 'marketing', 'travel'],
};
/** Who may see passport data: Travel, or the single agent that holds every tool. */
const PASSPORT_OK: Record<Mode, string[]> = { single: ['single'], centralized: ['travel'], decentralized: ['travel'] };
const PART_STATE: Record<PartState, string> = { done: 'done', already: 'already in the plan', missing: 'missing' };

export function NetworkScreen({ mode, net, plan, plans, runs, live, info }: { mode: Mode; net: NetState; plan: Plan; plans: Plans; runs: Run[]; live: boolean; info: Info }) {
  const [view, setView] = useState<'map' | 'runs'>('map');
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [mode]);
  const kind = net.request ?? plan.request;
  const travel = kind === 'travel' || kind === 'travelUs';
  const last = plan.approvals?.at(-1);
  const person = last ? { status: last.status, by: mode === 'single' ? 'single' : last.requestedBy, old: !plan.run || last.run !== plan.run.id } : null;
  const seenBy = plan.passportSeenBy ?? [];
  return (
    <div className="screen network-screen">
      <header className="net-head">
        <div className="net-title">
          <h1>{view === 'runs' ? 'Compare runs' : MODE_TITLE[mode]}</h1>
          <p className="lede">
            {view === 'runs' ? 'Every finished run, in every setup. Run the same request in each setup and compare the rows.' : modeHint(mode, net.request)}
            {view === 'map' && mode === 'decentralized' && ` This request enters at ${LABEL[ENTRY[kind]]}.`}
          </p>
        </div>
        <Segmented
          label="Network view"
          value={view}
          onChange={setView}
          options={[
            { id: 'map', name: 'Network map' },
            { id: 'runs', name: `Compare runs (${runs.length})` },
          ]}
        />
      </header>
      {view === 'runs' ? (
        <RunsView runs={runs} plans={plans} live={live} info={info} />
      ) : (
        <>
          <Stats mode={mode} net={net} plan={plan} live={live} />
          <div className="net-body">
            <div className="net-map">
              <NetworkMap mode={mode} net={net} seenBy={seenBy} entry={ENTRY[kind]} person={person} picked={picked} onPick={(id) => setPicked(picked === id ? null : id)} />
              <div className="map-foot">
                <Legend mode={mode} />
                {(travel || seenBy.length > 0) && <PassportNote mode={mode} seenBy={seenBy} />}
              </div>
            </div>
            <div className="net-side">
              {picked && mode !== 'single' ? (
                <AgentCard id={`${mode === 'centralized' ? 'spec' : 'peer'}-${picked}`} onClose={() => setPicked(null)} />
              ) : (
                <>
                  <h2 className="side-title">Activity</h2>
                  <Log turns={net.turns} board={net.board} mode={mode} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The A2A agent card of a specialist or peer, as other agents discover it: read from the server, shown as a card. */
function AgentCard({ id, onClose }: { id: string; onClose: () => void }) {
  const url = `/api/.well-known/${id}/agent-card.json`;
  const [card, setCard] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCard(null);
    setError(null);
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setCard)
      .catch((e) => setError(`Could not load the agent card (${e.message}).`));
  }, [url]);
  const node = id.replace(/^(spec|peer)-/, '');
  const auth = card ? (Object.keys(card.securitySchemes ?? {}).length ? Object.keys(card.securitySchemes).join(', ') : 'none (local demo)') : '';
  return (
    <section className="agent-card" aria-label={`A2A agent card of ${LABEL[node] ?? node}`}>
      <header>
        <div>
          <h3>{LABEL[node] ?? node}: A2A agent card</h3>
          <span className="ac-id">{id}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close the agent card">
          <X aria-hidden="true" />
        </button>
      </header>
      {error && <p className="problem-text">{error}</p>}
      {!card && !error && <p className="quiet">Loading…</p>}
      {card && (
        <>
          <p>{String(card.description ?? '').split('\n')[0]}</p>
          <dl>
            <dt>Endpoint</dt>
            <dd>{card.url}</dd>
            <dt>Streaming</dt>
            <dd>{card.capabilities?.streaming ? 'yes' : 'no'}</dd>
            <dt>Auth</dt>
            <dd>{auth}</dd>
            <dt>Protocol</dt>
            <dd>A2A {card.protocolVersion}</dd>
          </dl>
          <h4>Skills ({(card.skills ?? []).length})</h4>
          <ul className="ac-skills">
            {(card.skills ?? []).map((s: any) => (
              <li key={s.id} className={/^WRITE/.test(s.description ?? '') ? 'write' : ''} title={s.description}>
                {s.name}
              </li>
            ))}
          </ul>
          <p className="note">Dark skills write the plan. Another agent sees only this card: not the prompt, the memory or the other agents' tools.</p>
          <a className="link" href={url} target="_blank" rel="noreferrer">
            Raw agent card
          </a>
        </>
      )}
    </section>
  );
}

/** One stat with a short explanation on hover or keyboard focus (and on tap, which focuses it). */
function Stat({ label, value, sub, quiet, children }: { label: string; value: ReactNode; sub?: string; quiet?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <li className={`stat ${quiet ? 'quiet' : ''}`} tabIndex={0} aria-describedby={id}>
      <span className="stat-label">{label}</span>
      <b className="stat-value num">{value}</b>
      {sub && <span className="stat-sub">{sub}</span>}
      <div className="stat-tip" role="tooltip" id={id}>
        {children}
      </div>
    </li>
  );
}

function Stats({ mode, net, plan, live }: { mode: Mode; net: NetState; plan: Plan; live: boolean }) {
  const busy = Object.values(net.nodes).filter((n) => n.busy > 0).length;
  const pr = progress(plan);
  const parts = Object.entries(pr.parts);
  const started = net.llmCalls > 0;
  return (
    <ul className="stats" aria-label="This run">
      <Stat label={live ? 'seconds' : 'seconds, simulated'} value={secs(net).toFixed(1)}>
        Wall time of this run, from the first model call to the last event.{!live && ' Mock: scripted latency plus the fake outside systems.'}
      </Stat>
      <Stat label="LLM calls" value={net.llmCalls}>
        Model calls of all agents in this run.
      </Stat>
      <Stat label={live ? 'tokens' : 'tokens, estimated'} value={fmtK(net.tokens)}>
        {live ? 'Input and output tokens of all model calls in this run.' : 'Input and output tokens of all model calls, estimated as characters divided by 4 (mock model).'}
      </Stat>
      <Stat label="agent messages" value={net.messages} sub={mode === 'single' ? 'no other agent' : undefined}>
        Messages between agents: A2A delegations and peer questions. Tool calls do not count. Always 0 for the single agent: it has no other agent to talk to.
      </Stat>
      <Stat label="plan parts done" value={started || pr.done ? `${pr.done} of ${pr.of}` : `0 of ${pr.of}`} sub={pr.already ? `${pr.already} already in the plan` : undefined}>
        <span>What this run wrote of the parts its request needs.</span>
        <ul className="tip-parts">
          {parts.map(([k, v]) => (
            <li key={k} className={v}>
              <span>{PART_NAME[k] ?? k}</span>
              <b>{PART_STATE[v]}</b>
            </li>
          ))}
        </ul>
      </Stat>
      <Stat label="working" value={busy} quiet>
        Agents running right now.
      </Stat>
    </ul>
  );
}

/** Who saw passport data: measured on every model call (the server checks each prompt for passport numbers). */
function PassportNote({ mode, seenBy }: { mode: Mode; seenBy: string[] }) {
  const others = AGENTS[mode].filter((a) => !seenBy.includes(a));
  return (
    <div className="passport-note" role="status">
      <ShieldCheck aria-hidden="true" />
      <p>
        <b>Passport data</b> seen by {seenBy.length ? seenBy.map((a) => LABEL[a]).join(', ') : 'no agent yet'}.
        {others.length > 0 && mode !== 'single' && <> Not seen by {others.map((a) => LABEL[a]).join(', ')}.</>}
        {mode === 'single' && ' The one agent holds every tool, so it holds the passports too.'} Checked on every model call. In this log passport numbers show as [passport].
      </p>
    </div>
  );
}

const STATUS: Record<RunStatus, { name: string; pill: string }> = {
  completed: { name: 'Completed', pill: 'ok' },
  'no-writes': { name: 'Ended without writing', pill: 'warn' },
  failed: { name: 'Failed', pill: 'problem' },
  limit: { name: 'Stopped by a limit', pill: 'warn' },
};
const DECISION: Record<string, string> = { pending: 'waits', approved: 'approved', declined: 'declined', invalidated: 'replaced' };

/** Every finished run in every setup, full width: the numbers the talk compares. */
function RunsView({ runs, plans, live, info }: { runs: Run[]; plans: Plans; live: boolean; info: Info }) {
  const [open, setOpen] = useState<string | null>(null);
  const label = live
    ? `Measured once on this machine with ${info.models?.large ?? 'the large model'} and ${info.models?.small ?? 'the small model'}${info.effort && info.effort !== 'default' ? `, reasoning effort ${info.effort}` : ''}. One run each, not a benchmark.`
    : 'Simulated: mock model. Time is scripted latency plus the fake outside systems, tokens are estimated (characters divided by 4). Only the structure is real.';
  return (
    <div className="runs-view">
      <p className={`runs-label ${live ? 'live' : 'mock'}`}>{label}</p>
      {!runs.length ? (
        <p className="runs-empty">No finished run yet. Send a request in the assistant, then switch the setup and send the same request again. Every finished run lands here.</p>
      ) : (
        <div className="runs-table">
          <table className="data runs-data">
            <thead>
              <tr>
                <th>Setup</th>
                <th>Request</th>
                <th>Status</th>
                <th className="r">Seconds</th>
                <th className="r">LLM calls</th>
                <th className="r">Tokens</th>
                <th className="r">Agent messages</th>
                <th className="r">Plan parts done</th>
                <th>Saw passport data</th>
                <th>Approvals</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const st = STATUS[r.status];
                const plan = plans[r.mode];
                const approvals = r.approvals.map((id) => plan?.approvals.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
                const wrong = r.seenBy.filter((a) => !PASSPORT_OK[r.mode].includes(a));
                const partList = Object.entries(r.parts).map(([k, v]) => `${PART_NAME[k] ?? k}: ${PART_STATE[v]}`).join('\n');
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td data-label="Setup">
                        <b>{MODE_NAME[r.mode]}</b>
                      </td>
                      <td data-label="Request">
                        {REQUESTS[r.request].title}
                        <div className="note num">{clock(r.at)}</div>
                      </td>
                      <td data-label="Status">
                        <span className={`pill ${st.pill}`}>{st.name}</span>
                        {r.status === 'no-writes' && (
                          <div className="note num">
                            {r.done} of {r.of} after {r.seconds.toFixed(1)} s
                          </div>
                        )}
                        {r.note && <div className="note">{r.note}</div>}
                        {r.answer && (
                          <button className="link small" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {open === r.id ? 'Hide final answer' : 'Final answer'}
                          </button>
                        )}
                      </td>
                      <td data-label="Seconds" className="r num">
                        {r.seconds.toFixed(1)}
                      </td>
                      <td data-label="LLM calls" className="r num">
                        {r.llm}
                      </td>
                      <td data-label="Tokens" className="r num">
                        {fmtK(r.tokens)}
                      </td>
                      <td data-label="Agent messages" className="r num">
                        {r.messages}
                        {r.mode === 'single' && <div className="note">alone</div>}
                      </td>
                      <td data-label="Plan parts done" className="r num" title={partList}>
                        {r.done} of {r.of}
                        {r.already > 0 && <div className="note">{r.already} already in the plan</div>}
                      </td>
                      <td data-label="Saw passport data">
                        {r.seenBy.length ? (
                          <span className={wrong.length ? 'problem-text' : ''}>{r.seenBy.map((a) => LABEL[a] ?? a).join(', ')}</span>
                        ) : (
                          <span className="quiet">nobody</span>
                        )}
                      </td>
                      <td data-label="Approvals">
                        {approvals.length ? (
                          approvals.map((a) => (
                            <div key={a.id} className="num">
                              {eur(a.args.totalEur)} <span className={`pill ${a.status === 'approved' ? 'ok' : a.status === 'pending' ? 'warn' : 'quiet'}`}>{DECISION[a.status] ?? a.status}</span>
                              {a.status === 'declined' && a.reason && <div className="note">{a.reason}</div>}
                            </div>
                          ))
                        ) : (
                          <span className="quiet">none</span>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr className="answer-row">
                        <td colSpan={10}>
                          <h3>Final answer</h3>
                          <p>{r.answer}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Legend({ mode }: { mode: Mode }) {
  return (
    <div className="legend">
      {mode === 'single' && (
        <span>
          <i className="l-tool" />
          tool call into a domain
        </span>
      )}
      {mode !== 'single' && (
        <span>
          <i className="l-a2a" />
          A2A message
        </span>
      )}
      {mode === 'centralized' && (
        <span>
          <i className="l-possible" />
          possible delegation
        </span>
      )}
      {mode === 'decentralized' && (
        <span>
          <i className="l-board" />
          plan board
        </span>
      )}
      <span>
        <i className="l-tick" />
        tool used
      </span>
      <span>
        <i className="l-busy" />
        thinking now
      </span>
    </div>
  );
}

/** The activity log: one group per agent turn (one model call and what it decided), newest at the bottom. */
function Log({ turns, board, mode }: { turns: Turn[]; board: NetState['board']; mode: Mode }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => turns.filter((t) => t.entries.length > 0), [turns]);
  const count = shown.reduce((s, t) => s + t.entries.length, 0);
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current) ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [count]);
  const sections = useMemo(() => board.slice(-4), [board]);
  return (
    <div className="logwrap">
      <div
        className="log"
        ref={ref}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {shown.length === 0 && <p className="empty">Nothing yet. Send a request in the assistant.</p>}
        {shown.map((t) => (
          <section key={t.id} className={`turn d-${t.agent}`}>
            <h3 className="turn-head">
              <i className="stop" aria-hidden="true" />
              {LABEL[t.agent] ?? t.agent}
              <span className="turn-meta num">
                {t.agent === 'person' ? 'outside the agents' : `step ${t.step}`}
                {t.modelMs ? `, thought ${(t.modelMs / 1000).toFixed(1)} s` : ''}
              </span>
              {t.sawPassport && <span className="pp-tag">saw passports</span>}
            </h3>
            <ol>
              {t.entries.map((e) => (
                <LogEntry key={e.id} e={e} />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {mode === 'decentralized' && sections.length > 0 && (
        <div className="boardlist">
          <h3>Plan board</h3>
          {sections.map((b, k) => (
            <p key={k}>
              <b>{LABEL[b.agent] ?? b.agent}:</b> {b.note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function LogEntry({ e }: { e: Entry }) {
  const s = e.kind === 'decision' ? e.text : sentence(e);
  return (
    <li className={`entry ${e.kind} ${e.pending ? 'pending' : ''}`}>
      <details>
        <summary>
          <ChevronRight className="chev" aria-hidden="true" />
          <span className="what">
            {s}
            {e.kind === 'write' && <span className="write-tag">writes the plan</span>}
            {e.via === 'a2a' && <span className="a2a-tag">A2A</span>}
            {e.task && <span className="task-tag">task {e.task.state}</span>}
            {e.system && <span className="sys-tag">{e.system.split(',')[0]}, fake, {((e.ms ?? 0) / 1000).toFixed(1)} s</span>}
          </span>
          {e.kind === 'message' && <span className="reply-line">{replyLine(e)}</span>}
        </summary>
        <div className="entry-detail">
          {e.kind === 'message' ? (
            <>
              <h4>Request</h4>
              <pre>{e.text}</pre>
              <h4>Answer{e.redacted ? `, ${e.redacted} passport numbers redacted` : ''}</h4>
              <pre>{e.pending ? 'Waiting…' : e.reply}</pre>
              {e.task && (
                <>
                  <h4>A2A task</h4>
                  <pre>{`id ${e.task.id}\nstates: ${e.task.state} (message/send returned the finished task)`}</pre>
                </>
              )}
            </>
          ) : e.kind === 'board' || e.kind === 'decision' ? (
            <pre>{e.text}</pre>
          ) : (
            <>
              <h4>
                <code>{e.tool}</code> arguments
              </h4>
              <pre>{show(e.args ?? {})}</pre>
              <h4>Result{e.ms !== undefined ? `, ${(e.ms / 1000).toFixed(1)} s` : ''}</h4>
              <pre>{e.pending ? 'Running…' : show(e.result)}</pre>
            </>
          )}
        </div>
      </details>
    </li>
  );
}
