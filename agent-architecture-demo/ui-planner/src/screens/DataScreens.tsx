import { useMemo, useState } from 'react';
import { checkSum, clock, eur, type Base, type CostDomain, type Plan, type Track } from '../api';
import { ApprovalCard } from '../approval';
import type { Mode } from '../network';
import { AccessStatus, Attribution, BudgetBar, COST_NAME, COST_ORDER, PassportPanel, roomUses, ScheduleGrid, StaleNote } from '../plan-parts';
import { freshClass, writerName, NotYet, Panel, realPrev, ScreenHead, Search, Segmented, Who } from '../ui';

const match = (q: string, ...xs: (string | number)[]) => !q || xs.some((x) => String(x).toLowerCase().includes(q.toLowerCase()));
const trackIndex = (base: Base, t: Track) => base.event.tracks.indexOf(t) + 1;

// ---------------- Program ----------------
export function Program({ base, plan }: { base: Base; plan: Plan }) {
  const [tab, setTab] = useState<'schedule' | 'tracks' | 'submissions'>('schedule');
  const [q, setQ] = useState('');
  const [track, setTrack] = useState<'all' | Track>('all');
  const placed = useMemo(() => new Map(Object.values(plan.slots).map((s) => [s.submissionId, s])), [plan.slots]);
  const rows = base.submissions.filter((s) => (track === 'all' || s.track === track) && match(q, s.id, s.title, s.speaker, s.origin));
  return (
    <div className="screen">
      <ScreenHead title="Program">
        {base.submissions.length} submissions in 3 tracks, 10 slots per track. {placed.size} talks scheduled.
      </ScreenHead>
      <Segmented
        label="View"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'schedule', name: 'Schedule' },
          { id: 'tracks', name: 'Accepted talks' },
          { id: 'submissions', name: `All submissions (${base.submissions.length})` },
        ]}
      />
      {tab === 'schedule' && (
        <Panel>
          {placed.size === 0 && <NotYet>No talks scheduled yet. Program places them once the shortlist is ready.</NotYet>}
          <ScheduleGrid plan={plan} base={base} />
        </Panel>
      )}
      {tab === 'tracks' && (
        <div className="cols-3">
          {base.event.tracks.map((t) => {
            const list = Object.values(plan.slots)
              .filter((s) => s.track === t)
              .sort((a, b) => a.day - b.day || a.slot - b.slot);
            return (
              <Panel key={t} title={<><i className={`tk tk${trackIndex(base, t)}`} aria-hidden="true" /> {t}</>} aside={<span className="num quiet">{list.length} of 10</span>}>
                {list.length ? (
                  <ol className="talk-list">
                    {list.map((s) => (
                      <li key={s.submissionId} className={freshClass(s).trim()}>
                        <span className="num quiet">
                          Day {s.day}, {s.time}
                        </span>
                        <b>{s.title}</b>
                        <span>{s.speaker}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="quiet">No talks accepted yet.</p>
                )}
                {list[0] && (
                  <p className="by-line">
                    <Who m={list[0]} />
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      {tab === 'submissions' && (
        <Panel>
          <div className="filters">
            <Search value={q} onChange={setQ} label="Search title, speaker, ID" />
            <Segmented label="Track" value={track} onChange={setTrack} options={[{ id: 'all', name: 'All tracks' }, ...base.event.tracks.map((t) => ({ id: t, name: t }))]} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Speaker</th>
                  <th>Track</th>
                  <th className="r">Rating</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const p = placed.get(s.id);
                  return (
                    <tr key={s.id} className={freshClass(p).trim()}>
                      <td className="num quiet">{s.id}</td>
                      <td>{s.title}</td>
                      <td>
                        {s.speaker} <span className="quiet">({s.origin})</span>
                      </td>
                      <td>
                        <i className={`tk tk${trackIndex(base, s.track)}`} aria-hidden="true" /> {s.track}
                      </td>
                      <td className="r num">{s.rating.toFixed(1)}</td>
                      <td>{p ? <><span className="pill ok">Day {p.day}, {p.time}</span> <Who m={p} verb={false} /></> : <span className="quiet">Not scheduled</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="quiet pad">No submission matches “{q}”.</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------- Speakers ----------------
export function Speakers({ base, plan }: { base: Base; plan: Plan }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'scheduled' | 'flying'>('all');
  const slotOf = useMemo(() => new Map(Object.values(plan.slots).map((s) => [s.submissionId, s])), [plan.slots]);
  const rows = base.speakers.filter((s) => (f === 'all' || (f === 'scheduled' ? slotOf.has(s.submissionId) : s.needsFlight)) && match(q, s.name, s.origin, s.talk, s.id));
  const intl = base.speakers.filter((s) => s.shortlisted && s.needsFlight).length;
  return (
    <div className="screen">
      <ScreenHead title="Speakers">
        {base.speakers.length} speakers, one per submission. {intl} shortlisted speakers fly in. Everyone from DE, AT and CH comes by train.
      </ScreenHead>
      <Panel>
        <div className="filters">
          <Search value={q} onChange={setQ} label="Search name, country, talk" />
          <Segmented label="Filter" value={f} onChange={setF} options={[{ id: 'all', name: 'All' }, { id: 'scheduled', name: 'Scheduled' }, { id: 'flying', name: 'Need a flight' }]} />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Speaker</th>
                <th>From</th>
                <th>Talk</th>
                <th>Slot</th>
                <th>Travel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const slot = slotOf.get(s.submissionId);
                const t = plan.travel[s.id];
                const f = plan.flights[s.id];
                const h = plan.hotels[s.id];
                return (
                  <tr key={s.id} className={freshClass(t ?? h ?? f ?? slot).trim()}>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td>{s.origin}</td>
                    <td>
                      {s.talk} <span className="quiet">({s.track})</span>
                    </td>
                    <td className="num">{slot ? `Day ${slot.day}, ${slot.time}` : <span className="quiet">Not scheduled</span>}</td>
                    <td>
                      {t ? (
                        <>
                          <span className="pill ok">Booked {eur(t.totalEur)}</span> <Who m={t} verb={false} />
                        </>
                      ) : f || h ? (
                        <>
                          <span className={`pill ${f && h ? 'ok' : 'warn'}`}>{f && h ? `Flight and hotel, ${eur(f.eur + h.eur)}` : f ? 'Flight booked, no hotel' : 'Hotel booked, no flight'}</span> <Who m={(h ?? f)!} verb={false} />
                        </>
                      ) : !s.shortlisted ? (
                        <span className="quiet">Not shortlisted</span>
                      ) : !s.needsFlight ? (
                        <span className="quiet">Train, no booking needed</span>
                      ) : (
                        <span className="pill warn">Not booked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="quiet pad">No speaker matches.</p>}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Rooms ----------------
export function Rooms({ base, plan }: { base: Base; plan: Plan }) {
  return (
    <div className="screen">
      <ScreenHead title="Rooms">
        Four bookable rooms and the foyer. Price per day, AV adds {eur(4500)} per day. Venue assigns, Accessibility checks.
      </ScreenHead>
      <Panel>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Room</th>
                <th className="r">Seats</th>
                <th className="r">Per day</th>
                <th>Availability</th>
                <th>Access (plan)</th>
                <th>Use in the plan</th>
                <th>Written by</th>
              </tr>
            </thead>
            <tbody>
              {base.rooms.map((r) => {
                const p = plan.rooms[r.id];
                const a = plan.access[r.id];
                const bookable = r.id !== 'Foyer';
                return (
                  <tr key={r.id} className={`${p?.dropped ? 'row-dropped' : ''} ${freshClass(p ?? a).trim()}`}>
                    <td>
                      <b>{r.id}</b>
                      {r.inductionLoop && <span className="quiet"> (induction loop)</span>}
                    </td>
                    <td className="r num">{r.seats}</td>
                    <td className="r num">{r.eurPerDay ? eur(r.eurPerDay) : 'free'}</td>
                    <td>{r.availability ?? (r.note ? r.note : '')}</td>
                    <td>
                      {bookable ? <AccessStatus plan={plan} room={r.id} /> : <span className="quiet">Catering and expo only</span>}
                      {a?.note && <div className="note">{a.note}</div>}
                    </td>
                    <td>
                      {bookable ? (roomUses(p).join(', ') || <span className="quiet">Not assigned</span>) : <span className="quiet">Not bookable for talks</span>}
                      {p?.dropped && p.note && <div className="note">{p.note}</div>}
                      {realPrev(p) && <div className="note">Before: {roomUses(realPrev(p) as any).join(', ') || 'not assigned'}</div>}
                    </td>
                    <td>
                      <div className="stack">
                        {p && <Who m={p} />}
                        {a && <Who m={a} />}
                        {!p && !a && bookable && <span className="quiet">Nobody yet</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Live captions" domain="access">
        {plan.captions ? (
          <p>
            Booked for {plan.captions.rooms.join(', ')}, {eur(plan.captions.totalEur)} for 2 days. <Who m={plan.captions} />
          </p>
        ) : (
          <p className="quiet">Not booked yet. {eur(base.captioning.eurPerRoomDay)} per room and day, {base.captioning.note}.</p>
        )}
      </Panel>
    </div>
  );
}

// ---------------- Catering ----------------
export function Catering({ base, plan }: { base: Base; plan: Plan }) {
  const c = plan.catering;
  return (
    <div className="screen">
      <ScreenHead title="Catering">
        Two caterers, {base.event.attendees} people, {base.event.days} days. Dietary needs from {base.dietary.basedOn}.
      </ScreenHead>
      <div className="row-2">
        <Panel title="Chosen offer" domain="catering" className={freshClass(c).trim()}>
          {c ? (
            <>
              <p className="big-line">
                <b>{c.caterer}</b>
              </p>
              <p className="num">
                {c.headcount} people x {c.days} days x {eur(c.eurPerPersonDay)} = <b>{eur(c.totalEur)}</b>
              </p>
              <Who m={c} />
            </>
          ) : (
            <p className="quiet">No caterer chosen yet.</p>
          )}
        </Panel>
        <Panel title="Dietary needs">
          <dl className="figures">
            <div>
              <dt>Vegetarian</dt>
              <dd className="num">{base.dietary.vegetarian}</dd>
            </div>
            <div>
              <dt>Vegan</dt>
              <dd className="num">{base.dietary.vegan}</dd>
            </div>
            <div>
              <dt>Gluten-free</dt>
              <dd className="num">{base.dietary.glutenFree}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Panel title="Caterers">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Caterer</th>
                <th className="r">Per person and day</th>
                <th>Vegan</th>
                <th>Gluten-free</th>
                <th>Includes</th>
                <th className="r">For 600 x 2 days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {base.caterers.map((k) => (
                <tr key={k.id} className={c?.caterer === k.id ? `row-chosen${freshClass(c)}` : ''}>
                  <td>
                    <b>{k.id}</b>
                  </td>
                  <td className="r num">{eur(k.eurPerPersonDay)}</td>
                  <td>{k.vegan ? 'Yes' : <span className="problem-text">No vegan menu</span>}</td>
                  <td>{k.glutenFree ? 'Yes' : 'No'}</td>
                  <td>{k.note}</td>
                  <td className="r num">{eur(k.eurPerPersonDay * base.event.attendees * base.event.days)}</td>
                  <td>{c?.caterer === k.id ? <span className="pill ok">Chosen</span> : <span className="quiet">Not chosen</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Travel ----------------
export function Travel({ base, plan, mode }: { base: Base; plan: Plan; mode: Mode }) {
  const bookings = plan.request === 'travel' || plan.request === 'travelUs' || plan.approvals.length > 0 || Object.keys(plan.flights).length > 0;
  return bookings ? <TravelBookings base={base} plan={plan} mode={mode} /> : <TravelListPrices base={base} plan={plan} />;
}

/** First request: flight and hotel at list prices. */
function TravelListPrices({ base, plan }: { base: Base; plan: Plan }) {
  const travellers = base.speakers.filter((s) => s.shortlisted && s.needsFlight);
  const booked = Object.values(plan.travel);
  const total = booked.reduce((s, t) => s + t.totalEur, 0);
  return (
    <div className="screen">
      <ScreenHead title="Travel">
        {travellers.length} shortlisted speakers need a flight. Hotel {eur(base.travel.hotelEurPerNight)} per night, 3 nights, at list prices. The second request books through the airline and hotel systems instead.
      </ScreenHead>
      {plan.approvals.length > 0 && <ApprovalCard plan={plan} />}
      {booked.length === 0 && plan.approvals.length === 0 && <NotYet first="travelUs">No travel booked yet.</NotYet>}
      <Panel title="Bookings at list prices" domain="travel" aside={<span className="num">{booked.length} of {travellers.length} booked, {eur(total)}</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Speaker</th>
                <th>From</th>
                <th className="r">Flight</th>
                <th className="r">Hotel</th>
                <th className="r">Total</th>
                <th>Booked by</th>
              </tr>
            </thead>
            <tbody>
              {travellers.map((s) => {
                const t = plan.travel[s.id];
                return (
                  <tr key={s.id} className={freshClass(t).trim()}>
                    <td>
                      <b>{s.name}</b>
                    </td>
                    <td>{s.origin}</td>
                    <td className="r num">{eur(s.flightEur)}</td>
                    <td className="r num">{t ? `${t.nights} nights, ${eur(t.hotelEur)}` : <span className="quiet">open</span>}</td>
                    <td className="r num">{t ? <b>{eur(t.totalEur)}</b> : <span className="quiet">open</span>}</td>
                    <td>{t ? <Who m={t} verb={false} /> : <span className="pill warn">Not booked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total booked</td>
                <td className="r num">
                  <b>{eur(total)}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
}

const VISA_PILL: Record<string, string> = { 'visa-free': 'ok', 'visa needed': 'warn', 'passport too short': 'problem' };
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Second request: visa checks, flights from SkyQuote, hotel from RheinRooms. */
function TravelBookings({ base, plan, mode }: { base: Base; plan: Plan; mode: Mode }) {
  const us = plan.request === 'travelUs';
  const travellers = base.speakers.filter((s) => s.shortlisted && s.needsFlight && (!us || s.origin === 'US'));
  const flights = Object.values(plan.flights);
  const hotels = Object.values(plan.hotels);
  const total = flights.reduce((s, f) => s + f.eur, 0) + hotels.reduce((s, h) => s + h.eur, 0);
  const sys = base.systems;
  return (
    <div className="screen">
      <ScreenHead title="Travel">
        {travellers.length} {us ? 'speakers from the US' : 'speakers'} fly in and must arrive by {day(sys.arriveBy)}. Travel checks passports and visas, quotes in two slow outside systems and proposes one booking. A person approves it before anything is booked.
      </ScreenHead>
      {plan.approvals.length > 0 && <ApprovalCard plan={plan} />}
      <div className="row-2">
        <Panel title="Outside systems">
          <ul className="sys-list">
            <li>
              <b>{sys.systems.airline}</b>
              <span className="num">
                quote {sys.latencyMs.quoteFlights / 1000} s, book {sys.latencyMs.bookFlights / 1000} s
              </span>
            </li>
            <li>
              <b>{sys.systems.hotel}</b>
              <span className="num">
                quote {sys.latencyMs.quoteHotel / 1000} s, book {sys.latencyMs.bookHotel / 1000} s
              </span>
            </li>
            <li>
              <b>{sys.systems.passports}</b>
              <span className="num">read {sys.latencyMs.readPassports / 1000} s</span>
            </li>
          </ul>
          <p className="note">Fictional systems. The wait is simulated, in live and in mock mode. One call per system covers every speaker. Bookings run only after approval.</p>
        </Panel>
        <PassportPanel plan={plan} mode={mode} />
      </div>
      <Panel title="Speakers" domain="travel" aside={<span className="num">{flights.length} flights, {hotels.length} hotel stays, {eur(total)}</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Speaker</th>
                <th>Visa</th>
                <th>Flight</th>
                <th>Hotel</th>
                <th className="r">Cost</th>
                <th>Written by</th>
              </tr>
            </thead>
            <tbody>
              {travellers.map((s) => {
                const v = plan.visa[s.id];
                const f = plan.flights[s.id];
                const h = plan.hotels[s.id];
                const latest = [v, f, h].filter(Boolean).sort((a, b) => b!.at - a!.at)[0];
                return (
                  <tr key={s.id} className={freshClass(latest).trim()}>
                    <td>
                      <b>{s.name}</b> <span className="quiet">({s.origin})</span>
                    </td>
                    <td>
                      {v ? <span className={`pill ${VISA_PILL[v.status]}`}>{v.status}</span> : <span className="quiet">not checked</span>}
                      {v?.note && <div className="note">{v.note}</div>}
                    </td>
                    <td className="num">
                      {f ? (
                        <>
                          {f.from}, lands {day(f.arrives)} {f.arrives.slice(11)}
                          <div className="note">
                            {f.offerId}, {eur(f.eur)}
                          </div>
                        </>
                      ) : (
                        <span className="quiet">open</span>
                      )}
                    </td>
                    <td>
                      {h ? (
                        <>
                          {h.hotel}
                          <div className="note num">
                            {day(h.checkIn)} to {day(h.checkOut)}, {h.nights} nights at {eur(h.eurPerNight)}
                          </div>
                        </>
                      ) : (
                        <span className="quiet">open</span>
                      )}
                    </td>
                    <td className="r num">{f || h ? <b>{eur((f?.eur ?? 0) + (h?.eur ?? 0))}</b> : <span className="quiet">open</span>}</td>
                    <td>{latest ? <Who m={latest} verb={false} /> : <span className="pill warn">Not booked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Travel cost</td>
                <td className="r num">
                  <b>{eur(total)}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Budget ----------------
export function Budget({ base, plan, mode }: { base: Base; plan: Plan; mode: Mode }) {
  const check = plan.budgetCheck;
  const staleOf = (d: CostDomain) => plan.stale.find((s) => s.domain === d);
  return (
    <div className="screen">
      <ScreenHead title="Budget">
        {eur(base.budget.budgetEur)} in total. Each cost line belongs to the agent whose decision caused it. The budget check is a snapshot of what Budget saw.
      </ScreenHead>
      <Panel title="Planned against budget">
        <BudgetBar plan={plan} base={base} />
      </Panel>
      <div className="row-2">
        <Panel title="Budget check" domain="budget" className={`${plan.stale.length ? 'is-stale' : ''} ${freshClass(check)}`}>
          {check ? (
            <>
              <StaleNote plan={plan} />
              <p className="check-sum num">
                <b>{writerName(check)} checked:</b> {checkSum(check, plan.stale)}.
              </p>
              <table className="data">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="r">Checked</th>
                    <th className="r">Now</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Marketing (signed)</td>
                    <td className="r num">{eur(check.committedEur)}</td>
                    <td className="r num">{eur(plan.totals.committedEur)}</td>
                  </tr>
                  {COST_ORDER.map((d) => {
                    const checked = check.lines.filter((l) => l.domain === d);
                    const s = staleOf(d);
                    return (
                      <tr key={d} className={s ? 'row-stale' : ''}>
                        <td>
                          {COST_NAME[d]}
                          {checked.some((l) => l.estimate) && <span className="pill warn">estimate</span>}
                        </td>
                        <td className="r num">{checked.length ? eur(checked.reduce((x, l) => x + l.eur, 0)) : <span className="quiet">not checked</span>}</td>
                        <td className="r num">{plan.costs[d] ? eur(plan.costs[d]!.eur) : <span className="quiet">open</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="r num">
                      <b>{eur(check.totalEur)}</b>
                    </td>
                    <td className="r num">
                      <b>{eur(plan.totals.plannedEur)}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="check-result">
                {check.ok ? 'Within budget' : 'Over budget'} at the time of the check, buffer <b className="num">{eur(check.bufferEur)}</b>.{' '}
                {plan.stale.length === 0 ? 'The check matches the plan as it is now.' : 'The check does not match the plan any more.'}
              </p>
              <Who m={check} />
            </>
          ) : (
            <p className="quiet">{mode === 'single' ? 'The agent has not checked the budget yet.' : 'Budget has not checked the plan yet.'}</p>
          )}
        </Panel>
        <Panel title="Cost lines now">
          <table className="data">
            <thead>
              <tr>
                <th>Line and who wrote it</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {base.budget.committed.map((c) => (
                <tr key={c.item}>
                  <td>
                    <span className="line-name d-marketing"><i className="stop" aria-hidden="true" />{c.item}</span>
                    <div className="note">From the ledger</div>
                  </td>
                  <td className="r num">{eur(c.eur)}</td>
                </tr>
              ))}
              {COST_ORDER.map((d) => {
                const c = plan.costs[d];
                return (
                  <tr key={d} className={freshClass(c).trim()}>
                    <td>
                      <span className={`line-name d-${d}`}><i className="stop" aria-hidden="true" />{c?.item ?? COST_NAME[d]}</span>
                      {realPrev(c) && <div className="note num">Was {eur(realPrev(c)!.eur)} until {clock(c!.at)}</div>}
                      <div>{c ? <Who m={c} verb={false} /> : <span className="note">Nobody yet</span>}</div>
                    </td>
                    <td className="r num">{c ? eur(c.eur) : <span className="quiet">open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r num">
                  <b>{eur(plan.totals.plannedEur)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </Panel>

      </div>
      <Panel title="Income (for context)">
        <dl className="figures">
          <div>
            <dt>Tickets sold</dt>
            <dd className="num">
              {base.tickets.sold} at {eur(base.tickets.priceEur)}
            </dd>
          </div>
          <div>
            <dt>Sponsors signed</dt>
            <dd className="num">{eur(base.sponsors.signedEur)}</dd>
          </div>
          <div>
            <dt>Sponsor pipeline</dt>
            <dd className="num">{eur(base.sponsors.pipelineEur)}</dd>
          </div>
        </dl>
        <p className="quiet">{base.sponsors.top.join('. ')}.</p>
      </Panel>
    </div>
  );
}

