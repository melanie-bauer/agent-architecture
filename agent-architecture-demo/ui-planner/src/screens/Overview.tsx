import { eur, type Base, type Plan } from '../api';
import type { Mode } from '../network';
import { AccessStatus, Attribution, BudgetBar, ChangeFeed, PassportPanel, roomUses, ScheduleGrid, StaleNote } from '../plan-parts';
import { MAIN_REQUESTS, REQUESTS, requestTitle } from '../requests';
import { freshClass, MODE_TITLE, Panel, RequestButtons, ScreenHead, useRun, Who } from '../ui';

type Check = { key: string; name: string; screen: string };
const CONFERENCE_CHECKS: Check[] = [
  { key: 'talks', name: 'Talks', screen: 'program' },
  { key: 'rooms', name: 'Rooms', screen: 'rooms' },
  { key: 'access', name: 'Access', screen: 'rooms' },
  { key: 'catering', name: 'Catering', screen: 'catering' },
  { key: 'travel', name: 'Travel', screen: 'travel' },
  { key: 'budget', name: 'Budget check', screen: 'budget' },
  { key: 'risks', name: 'Risks', screen: 'overview' },
];
const ROOMS_CHECKS: Check[] = [
  { key: 'rooms', name: 'Rooms', screen: 'rooms' },
  { key: 'access', name: 'Access', screen: 'rooms' },
  { key: 'stepFree', name: 'Only step-free rooms', screen: 'rooms' },
  { key: 'budget', name: 'Budget check', screen: 'budget' },
];
const TRAVEL_US_CHECKS: Check[] = [
  { key: 'visa', name: 'Visa checks', screen: 'travel' },
  { key: 'booking', name: 'Booking proposed', screen: 'travel' },
  { key: 'budget', name: 'Budget check', screen: 'budget' },
  { key: 'passports', name: 'Passports only with Travel', screen: 'travel' },
];
const TRAVEL_CHECKS: Check[] = [
  { key: 'visa', name: 'Visa checks', screen: 'travel' },
  { key: 'flights', name: 'Flights', screen: 'travel' },
  { key: 'hotels', name: 'Hotels', screen: 'travel' },
  { key: 'talks', name: 'Talks', screen: 'program' },
  { key: 'budget', name: 'Budget check', screen: 'budget' },
  { key: 'passports', name: 'Passports only with Travel', screen: 'travel' },
];

export function Overview({ base, plan, mode, go }: { base: Base; plan: Plan; mode: Mode; go: (s: any) => void }) {
  const { running } = useRun();
  const empty = plan.changes.length === 0;
  const talks = Object.keys(plan.slots).length;
  const travelRequest = plan.request === 'travel' || plan.request === 'travelUs';
  const travellers = base.speakers.filter((s) => s.shortlisted && s.needsFlight && (plan.request !== 'travelUs' || s.origin === 'US')).length;
  const booked = travelRequest ? Object.keys(plan.flights).length : Object.keys(plan.travel).length;
  const risks = Object.values(plan.risks);
  const checks = { rooms: ROOMS_CHECKS, travelUs: TRAVEL_US_CHECKS, travel: TRAVEL_CHECKS, conference: CONFERENCE_CHECKS }[plan.request] ?? CONFERENCE_CHECKS;
  const pending = plan.approvals.find((a) => a.status === 'pending');
  const passportsOk = plan.inPlan.passports;

  return (
    <div className="screen">
      <ScreenHead title="Plan overview" actions={<RequestButtons first={plan.request} />}>
        {MODE_TITLE[mode]} plan for {base.event.attendees} attendees, {base.event.days} days, 3 tracks. {empty ? 'Every entry will show which agent wrote it.' : `Request: ${requestTitle(plan.request, plan.run?.text)}. Every entry shows which agent wrote it.`}
      </ScreenHead>

      {!empty && (
        <ul className="checklist" aria-label="Plan progress">
          {checks.map((c) => {
            const done = !!(plan.inPlan as Record<string, boolean | undefined>)[c.key];
            return (
              <li key={c.key}>
                <button className={done ? 'done' : c.key === 'passports' && passportsOk === false ? 'failed' : ''} onClick={() => go(c.screen)}>
                  <i aria-hidden="true" />
                  {c.name}
                  <span className="sr-only">{done ? ' done' : ' open'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pending && (
        <button className="callout person" onClick={() => go('travel')}>
          <b>A person decides.</b> A booking of {eur(pending.args.totalEur)} for {pending.args.speakers.length} speakers waits for your approval. Open Travel or the assistant to approve or decline.
        </button>
      )}

      {empty && (
        <div className="not-yet">
          <p>{running ? 'The agents are working. Their entries appear here as they write them.' : `The ${MODE_TITLE[mode].toLowerCase()} plan is empty. Pick a request above and watch it fill in.`}</p>
          <dl className="request-list">
            {MAIN_REQUESTS.map((k) => (
              <div key={k}>
                <dt>{REQUESTS[k].title}</dt>
                <dd>{REQUESTS[k].short}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="row-2">
        <Panel title="Budget" aside={<button className="link" onClick={() => go('budget')}>Details</button>}>
          <BudgetBar plan={plan} base={base} />
          <StaleNote plan={plan} />
        </Panel>
        <Panel title="Key figures">
          <dl className="figures">
            <div>
              <dt>Talks scheduled</dt>
              <dd className="num">{talks} of 30</dd>
            </div>
            <div>
              <dt>{travelRequest ? 'Flights booked' : 'Speakers booked'}</dt>
              <dd className="num">
                {booked} of {travellers}
              </dd>
            </div>
            {travelRequest ? (
              <>
                <div>
                  <dt>Hotel stays booked</dt>
                  <dd className="num">
                    {Object.keys(plan.hotels).length} of {travellers}
                  </dd>
                </div>
                <div>
                  <dt>Visa checks</dt>
                  <dd className="num">
                    {Object.keys(plan.visa).length} of {travellers}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>Tickets sold</dt>
                  <dd className="num">
                    {base.tickets.sold} of {base.tickets.cap}
                  </dd>
                </div>
                <div>
                  <dt>Ticket forecast</dt>
                  <dd className="num">{base.tickets.forecastByEvent}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Sponsors signed</dt>
              <dd className="num">{eur(base.sponsors.signedEur)}</dd>
            </div>
            <div>
              <dt>Sponsor pipeline</dt>
              <dd className="num">{eur(base.sponsors.pipelineEur)}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      {travelRequest ? (
        <PassportPanel plan={plan} mode={mode} />
      ) : (
        <Panel title="Rooms" aside={<button className="link" onClick={() => go('rooms')}>All rooms</button>}>
          <ul className="room-cards">
            {base.rooms
              .filter((r) => r.id !== 'Foyer')
              .map((r) => {
                const p = plan.rooms[r.id];
                const a = plan.access[r.id];
                const uses = roomUses(p);
                const bad = a && !a.stepFree;
                return (
                  <li key={r.id} className={`room-card ${p?.dropped ? 'is-dropped' : ''} ${bad ? 'is-bad' : ''}${freshClass(p && a ? (p.at > a.at ? p : a) : (p ?? a))}`}>
                    <div className="room-top">
                      <h3>{r.id}</h3>
                      <span className="num quiet">{r.seats} seats</span>
                    </div>
                    <AccessStatus plan={plan} room={r.id} />
                    <p className="uses">{uses.length ? uses.join(', ') : 'Not assigned'}</p>
                    {p?.dropped && p.note && <p className="note">{p.note}</p>}
                    {bad && !p?.dropped && <p className="note">{a.note}</p>}
                    <div className="room-who">
                      {p && <Who m={p} verb={false} />}
                      {a && <Who m={a} verb={false} />}
                    </div>
                  </li>
                );
              })}
          </ul>
        </Panel>
      )}

      <Panel title="Schedule" aside={<button className="link" onClick={() => go('program')}>Program</button>}>
        <ScheduleGrid plan={plan} base={base} compact />
      </Panel>

      <div className="row-2">
        <Panel title={`Open risks (${risks.length})`}>
          {risks.length ? (
            <ul className="risks">
              {risks.map((r) => (
                <li key={r.id} className={freshClass(r).trim()}>
                  <p>{r.text}</p>
                  <Attribution m={r} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="quiet">No risks recorded yet.</p>
          )}
        </Panel>
        <Panel title="Latest changes">
          <ChangeFeed changes={plan.changes} limit={7} />
        </Panel>
      </div>
    </div>
  );
}
