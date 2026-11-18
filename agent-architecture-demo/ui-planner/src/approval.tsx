// The approval card: a booking an agent proposed, stored on the server with its exact arguments.
// A person approves (the server books exactly these arguments, no model call) or declines with a reason
// (the setup then gets a new run: "The booking was declined: <reason>. Propose a new booking.").
// The same card shows in the conversation (under the answer of the run that proposed it) and on the Travel screen.
// While a request runs in the setup, the card's buttons wait: a decision mid-run would race the agents.
import { Check, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { approveBooking, checkSum, clock, declineBooking, eur, type Approval, type Plan } from './api';
import { Who, useRun } from './ui';

const VISA_PILL: Record<string, string> = { 'visa-free': 'ok', 'visa needed': 'warn', 'passport too short': 'problem' };
const day = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The approval the card is about: the open one, otherwise the latest decision. */
export const currentApproval = (plan: Plan | null): Approval | undefined => {
  const list = plan?.approvals ?? [];
  return list.find((a) => a.status === 'pending') ?? list.at(-1);
};

/** The approval the current run proposed (the chat shows it under that run's answer). */
export const runApproval = (plan: Plan | null): Approval | undefined => {
  if (!plan?.run) return undefined;
  return [...plan.approvals].reverse().find((a) => a.run === plan.run!.id);
};

/** Each price line with its factors, so the room can check the sum. */
function Sums({ a }: { a: Approval }) {
  const n = a.args.speakers.length;
  const perFlight = n && a.args.flights.every((f) => f.eur === a.args.flights[0].eur) ? a.args.flights[0]?.eur : null;
  const h = a.args.hotel;
  return (
    <dl className="ap-sums">
      {a.args.flights.length > 0 && (
        <div>
          <dt>Flights</dt>
          <dd className="num">
            {perFlight != null ? `${a.args.flights.length} x ${eur(perFlight)} = ` : ''}
            <b>{eur(a.args.flightsEur)}</b>
          </dd>
        </div>
      )}
      {h && (
        <div>
          <dt>Hotel</dt>
          <dd className="num">
            {n} x {h.nights} {h.nights === 1 ? 'night' : 'nights'} x {eur(h.eurPerNight)} = <b>{eur(a.args.hotelEur)}</b>
          </dd>
        </div>
      )}
      <div className="ap-total">
        <dt>Total</dt>
        <dd className="num">{eur(a.args.totalEur)}</dd>
      </div>
    </dl>
  );
}

export function ApprovalCard({ plan, compact = false, approval }: { plan: Plan; compact?: boolean; approval?: Approval }) {
  const a = approval ?? currentApproval(plan);
  const { followUp, running } = useRun();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!a) return null;
  const open = a.status === 'pending';
  const h = a.args.hotel;
  const earlier = plan.approvals.filter((x) => x.id !== a.id && x.status === 'declined');

  const doApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveBooking(a.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doDecline = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await declineBooking(a.id, reason.trim());
      setDeclining(false);
      setReason('');
      if (r.message) await followUp(r.message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`approval ${open ? 'open' : a.status} ${compact ? 'compact' : ''}`} aria-label="Booking approval">
      <header className="ap-head">
        <span className="ap-person">
          <UserRound aria-hidden="true" />A person decides
        </span>
        <h2>{open ? (a.executing ? 'Booking now' : 'Booking waits for your approval') : a.status === 'approved' ? 'Booking approved' : a.status === 'declined' ? 'Booking declined' : 'Booking no longer valid'}</h2>
        <p className="ap-who">
          Proposed by <Who m={{ by: a.requestedBy, domain: 'travel', mode: a.mode, at: a.at }} verb={false} /> with <code>{a.tool}</code>
        </p>
      </header>

      <div className="ap-body">
        <p className="ap-people">
          <b>{a.args.speakers.length} speakers:</b> {a.args.speakers.map((s) => s.name).join(', ')}
        </p>
        {h && (
          <p className="ap-stay">
            {h.hotel}, {day(h.checkIn)} to {day(h.checkOut)}
            {a.args.flights[0] ? `. Flights land ${day(a.args.flights[0].arrives)}` : ''}
          </p>
        )}
        <Sums a={a} />
        {plan.budgetCheck && plan.budgetCheck.run === a.run && plan.budgetCheck.lines.some((l) => l.domain === 'travel') && (
          <p className="check-sum num">
            <b>Budget check:</b> {checkSum(plan.budgetCheck, plan.stale)}.
          </p>
        )}

        <details className="ap-evidence" open={!compact}>
          <summary>Evidence: quotes and visa status</summary>
          <ul className="ap-visa">
            {a.evidence.visa.map((v) => (
              <li key={v.name}>
                {v.name} <span className={`pill ${VISA_PILL[v.status] ?? ''}`}>{v.status}</span>
              </li>
            ))}
          </ul>
          <ul className="ap-quotes">
            {a.evidence.quotes.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="note">
            Arguments fixed when proposed (hash <code>{a.hash}</code>). Approve books exactly these, without a model call.
          </p>
        </details>
      </div>

      {open && !a.executing && (
        <div className="ap-actions">
          {declining ? (
            <form
              className="ap-decline"
              onSubmit={(e) => {
                e.preventDefault();
                void doDecline();
              }}
            >
              <label htmlFor={`reason-${a.id}`}>Why do you decline? The agents get this reason.</label>
              <textarea id={`reason-${a.id}`} value={reason} rows={2} required autoFocus placeholder="Two hotel nights are enough." onChange={(e) => setReason(e.target.value)} />
              <div className="ap-buttons">
                <button type="submit" className="btn danger" disabled={busy || !reason.trim() || running}>
                  <X aria-hidden="true" />
                  Decline and ask again
                </button>
                <button type="button" className="btn" onClick={() => setDeclining(false)} disabled={busy || running}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="ap-buttons">
              <button className="btn primary" onClick={doApprove} disabled={busy || running}>
                <Check aria-hidden="true" />
                Approve {eur(a.args.totalEur)}
              </button>
              <button className="btn" onClick={() => setDeclining(true)} disabled={busy || running}>
                <X aria-hidden="true" />
                Decline
              </button>
            </div>
          )}
          {running && <p className="ap-wait">The agents are still working. You can decide when they are done.</p>}
        </div>
      )}
      {open && a.executing && <p className="ap-status">Booking in SkyQuote and RheinRooms. The slow systems take a few seconds.</p>}
      {a.status === 'approved' && (
        <p className="ap-status ok">
          Approved by {a.decidedBy} at {clock(a.decidedAt!)}. Booked {a.result?.flights ?? 0} flights and {a.result?.hotels ?? 0} hotel stays.
        </p>
      )}
      {a.status === 'declined' && (
        <p className="ap-status">
          Declined by {a.decidedBy} at {clock(a.decidedAt!)}: {a.reason}
        </p>
      )}
      {a.status === 'invalidated' && <p className="ap-status">A newer proposal or a reset replaced it.</p>}
      {earlier.length > 0 && (
        <p className="ap-earlier">
          Earlier: {earlier.map((x) => `${eur(x.args.totalEur)} declined (${x.reason})`).join('; ')}
        </p>
      )}
      {error && (
        <p className="ap-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
