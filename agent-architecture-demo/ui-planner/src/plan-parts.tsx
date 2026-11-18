// Plan views used on more than one screen: budget bar, schedule grid, room status, change feed.
import { useState } from 'react';
import { clock, eur, type Base, type Change, type CostDomain, type Plan, type RoomEntry, type Track } from './api';
import { LABEL, type Mode } from './network';
import { DomainTag, freshClass, isFresh, Panel, realPrev, Segmented, Who, writerName } from './ui';

export const COST_ORDER: CostDomain[] = ['venue', 'catering', 'travel', 'access'];
export const COST_NAME: Record<CostDomain, string> = { venue: 'Venue', catering: 'Catering', travel: 'Travel', access: 'Captions' };

// ---------------- budget ----------------
export function BudgetBar({ plan, base }: { plan: Plan; base: Base }) {
  const budget = plan.totals.budgetEur;
  const segs = [
    ...base.budget.committed.map((c) => ({ key: c.item, domain: 'marketing', name: 'Marketing (signed)', eur: c.eur, meta: null as null | Plan['costs'][CostDomain] })),
    ...COST_ORDER.filter((d) => plan.costs[d]).map((d) => ({ key: d, domain: d, name: COST_NAME[d], eur: plan.costs[d]!.eur, meta: plan.costs[d]! })),
  ];
  const over = plan.totals.plannedEur > budget;
  return (
    <div className="budget">
      <div className="budget-figures">
        <p>
          <b className="big num">{eur(plan.totals.plannedEur)}</b> planned of <b className="num">{eur(budget)}</b>
        </p>
        <p className={over ? 'problem-text' : ''}>
          {over ? 'Over budget by ' : 'Buffer '}
          <b className="num">{eur(Math.abs(plan.totals.bufferEur))}</b>
        </p>
      </div>
      <div className="bar" role="img" aria-label={`Budget: ${eur(plan.totals.plannedEur)} planned of ${eur(budget)}`}>
        {segs.map((s) => (
          <span key={s.key} className={`seg-fill d-${s.domain}${freshClass(s.meta)}`} style={{ width: `${(Math.min(s.eur, budget) / budget) * 100}%` }} />
        ))}
      </div>
      <ul className="bar-legend">
        {segs.map((s) => (
          <li key={s.key} className={freshClass(s.meta).trim()}>
            <DomainTag domain={s.domain} />
            <span className="name">{s.name}</span>
            <b className="num">{eur(s.eur)}</b>
            {realPrev(s.meta) && <span className="was num">was {eur(realPrev(s.meta)!.eur)}</span>}
          </li>
        ))}
        <li>
          <i className="stop hollow" aria-hidden="true" />
          <span className="name">Not yet planned</span>
          <b className="num">{eur(Math.max(0, plan.totals.bufferEur))}</b>
        </li>
      </ul>
    </div>
  );
}

/** The budget check as the budget agent recorded it, next to the cost lines as they are now. */
export function StaleNote({ plan }: { plan: Plan }) {
  if (!plan.budgetCheck || plan.stale.length === 0) return null;
  return (
    <div className="callout warn" role="status">
      <b>Stale budget check.</b>{' '}
      {plan.stale.map((s, i) => (
        <span key={s.domain}>
          {i > 0 && ' '}
          {writerName(plan.budgetCheck!)} checked {COST_NAME[s.domain].toLowerCase()} at <b className="num">{s.checkedEur == null ? 'nothing' : eur(s.checkedEur)}</b>
          {s.estimate ? ' (an estimate)' : ''}. The plan now says <b className="num">{s.currentEur == null ? 'nothing' : eur(s.currentEur)}</b>.
        </span>
      ))}{' '}
      Nobody ran the check again.
    </div>
  );
}

// ---------------- rooms ----------------
export function roomUses(r?: RoomEntry) {
  if (!r) return [];
  if (r.dropped) return ['Dropped'];
  return [r.keynote && 'Keynotes', r.track && `${r.track} track`, r.overflow && 'Keynote overflow'].filter(Boolean) as string[];
}

export function AccessStatus({ plan, room }: { plan: Plan; room: string }) {
  const a = plan.access[room];
  if (!a) return <span className="pill quiet">Access not checked</span>;
  return <span className={`pill ${a.stepFree ? 'ok' : 'problem'}`}>{a.stepFree ? 'Step-free' : 'Not step-free'}</span>;
}

// ---------------- schedule ----------------
export function ScheduleGrid({ plan, base, compact = false }: { plan: Plan; base: Base; compact?: boolean }) {
  const [day, setDay] = useState('1');
  const d = Number(day);
  const roomOfTrack = (t: Track) => Object.values(plan.rooms).find((r) => !r.dropped && r.track === t)?.room;
  const unroomed = base.event.tracks.filter((t) => !roomOfTrack(t) && Object.values(plan.slots).some((s) => s.track === t));
  const cols = [...base.rooms.filter((r) => r.id !== 'Foyer').map((r) => r.id), ...unroomed.map((t) => `no room: ${t}`)];
  const slots = base.schedule.slots.filter((s) => s.day === d);
  const keynote = base.schedule.keynotes.find((k) => k.day === d)!;
  const keynoteRoom = Object.values(plan.rooms).find((r) => !r.dropped && r.keynote);
  const overflowRoom = Object.values(plan.rooms).find((r) => !r.dropped && r.overflow);
  const trackIn = (col: string) => (col.startsWith('no room: ') ? (col.slice(9) as Track) : plan.rooms[col] && !plan.rooms[col].dropped ? plan.rooms[col].track : null);
  const keynoteRow = (
    <tr className="keynote-row">
      <th scope="row" className="num">
        {keynote.time}
      </th>
      {cols.map((c) => (
        <td key={c} className={c === keynoteRoom?.room ? `kn${freshClass(keynoteRoom)}` : c === overflowRoom?.room ? `kn overflow${freshClass(overflowRoom)}` : 'empty'}>
          {c === keynoteRoom?.room ? keynote.title : c === overflowRoom?.room ? 'Overflow stream' : ''}
        </td>
      ))}
    </tr>
  );
  return (
    <div className={`schedule ${compact ? 'compact' : ''}`}>
      <div className="schedule-bar">
        <Segmented label="Day" value={day} onChange={setDay} options={[{ id: '1', name: 'Day 1, 11 May' }, { id: '2', name: 'Day 2, 12 May' }]} />
        <ul className="track-key">
          {base.event.tracks.map((t, i) => (
            <li key={t}>
              <i className={`tk tk${i + 1}`} aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col" className="time-col">
                Time
              </th>
              {cols.map((c) => {
                const r = plan.rooms[c];
                return (
                  <th key={c} scope="col" className={`${r?.dropped ? 'dropped' : ''}${freshClass(r)}`}>
                    <span>{c.startsWith('no room: ') ? 'No room yet' : c}</span>
                    <small>{c.startsWith('no room: ') ? c.slice(9) : r?.dropped ? 'Dropped' : trackIn(c) ?? (r?.keynote ? 'Keynotes only' : 'Not assigned')}</small>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {d === 1 && keynoteRow}
            {slots.map((s) => (
              <tr key={s.slot}>
                <th scope="row" className="num">
                  {s.time}
                </th>
                {cols.map((c) => {
                  const t = trackIn(c);
                  const entry = t ? plan.slots[`${t}|${s.day}|${s.slot}`] : undefined;
                  if (!entry) return <td key={c} className={plan.rooms[c]?.dropped ? 'empty dropped' : 'empty'} />;
                  const ti = base.event.tracks.indexOf(entry.track) + 1;
                  return (
                    <td key={c} className={`talk tk${ti}${freshClass(entry)}`} title={`${entry.submissionId}. Added by ${writerName(entry)}`}>
                      <b>{entry.title}</b>
                      {!compact && <span>{entry.speaker}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {d === 2 && keynoteRow}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- change feed ----------------
export function ChangeFeed({ changes, limit = 8 }: { changes: Change[]; limit?: number }) {
  const list = changes.slice(-limit).reverse();
  if (!list.length) return <p className="quiet">No changes yet.</p>;
  return (
    <ol className="feed">
      {list.map((c, i) => (
        <li key={`${c.at}-${i}`} className={isFresh(c.at) ? `flash d-${c.domain}` : ''}>
          <span className="feed-time num">{clock(c.at)}</span>
          <span className="feed-text">{c.summary}</span>
          <Who m={{ by: c.by, domain: c.domain, mode: c.mode, at: c.at, ...(c.action === 'changed' ? { prev: true } : {}) }} />
        </li>
      ))}
    </ol>
  );
}

export function Attribution({ m }: { m?: Parameters<typeof Who>[0]['m'] | null }) {
  return m ? <Who m={m} /> : <span className="quiet">Not in the plan yet</span>;
}

// ---------------- passport data (second request) ----------------
const PASSPORT_AGENTS: Record<Mode, string[]> = {
  single: ['single'],
  centralized: ['triage', 'program', 'travel', 'budget', 'venue', 'access', 'catering', 'marketing'],
  decentralized: ['program', 'travel', 'budget', 'venue', 'access', 'catering', 'marketing'],
};
/**
 * Which agents saw passport data, measured on the server: every model call is checked for passport numbers.
 * Like the redaction view of the Incident Desk: the boundary is shown, not claimed.
 */
export function PassportPanel({ plan, mode }: { plan: Plan; mode: Mode }) {
  const seen = plan.passportSeenBy ?? [];
  const ok = plan.complete.passports !== false;
  return (
    <Panel title="Passport data" domain="travel" aside={<span className={`pill ${ok ? 'ok' : 'problem'}`}>{ok ? (mode === 'single' ? 'One agent holds it' : 'Only Travel') : 'Seen outside Travel'}</span>}>
      <p className="lede-sm">
        Passports are personal data. {mode === 'single' ? 'The single agent holds every tool, so the passport registry lands in the same context as the budget, the program and everything else.' : 'Only Travel holds the passport registry tool. What Travel sends to other agents is redacted to [passport].'} The list is measured on every model call, not declared.
      </p>
      <ul className="seen-list">
        {PASSPORT_AGENTS[mode].map((a) => {
          const saw = seen.includes(a);
          return (
            <li key={a} className={`d-${a} ${saw ? 'saw' : ''}`}>
              <i className="stop" aria-hidden="true" />
              <span>{LABEL[a]}</span>
              <b>{saw ? 'saw passport data' : 'never saw it'}</b>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
