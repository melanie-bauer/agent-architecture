// Data the screens read: fixed base data (/planner/data/*) and the plan the agents write (/planner/plan).
import { useEffect, useState } from 'react';
import type { Mode, RequestKind } from './network';

export type Track = 'Agents' | 'AI Engineering' | 'AI in Practice';
export type CostDomain = 'venue' | 'catering' | 'travel' | 'access';
export type Meta = { by: string; domain: string; mode: Mode; at: number; run?: number };
export type Versioned<T> = T & Meta & { prev?: T & Meta };

export type SlotEntry = Versioned<{ track: Track; day: number; slot: number; time: string; submissionId: string; title: string; speaker: string }>;
export type RoomEntry = Versioned<{ room: string; keynote: boolean; overflow: boolean; track: Track | null; dropped: boolean; note?: string }>;
export type AccessEntry = Versioned<{ room: string; stepFree: boolean; note: string }>;
export type CateringEntry = Versioned<{ caterer: string; headcount: number; days: number; eurPerPersonDay: number; totalEur: number }>;
export type TravelEntry = Versioned<{ speakerId: string; name: string; origin: string; flightEur: number; nights: number; hotelEur: number; totalEur: number }>;
export type VisaEntry = Versioned<{ speakerId: string; name: string; status: 'visa-free' | 'visa needed' | 'passport too short'; note: string }>;
export type FlightEntry = Versioned<{ speakerId: string; name: string; offerId: string; ref: string; from: string; arrives: string; eur: number }>;
export type HotelEntry = Versioned<{ speakerId: string; name: string; hotel: string; ref: string; checkIn: string; checkOut: string; nights: number; eurPerNight: number; eur: number }>;
export type CostEntry = Versioned<{ domain: CostDomain; item: string; eur: number }>;
export type CheckLine = { domain: CostDomain; eur: number; estimate?: boolean };
export type BudgetCheck = Versioned<{ lines: CheckLine[]; committedEur: number; totalEur: number; budgetEur: number; bufferEur: number; ok: boolean }>;
export type RiskEntry = Versioned<{ id: string; text: string }>;
export type Change = { mode: Mode; kind: string; key: string; by: string; domain: string; at: number; summary: string; action: 'added' | 'changed' | 'removed' };
export type Stale = { domain: CostDomain; checkedEur: number | null; currentEur: number | null; estimate: boolean };

export type Approval = {
  id: string;
  mode: Mode;
  request: RequestKind;
  tool: string;
  requestedBy: string;
  at: number;
  /** the run that proposed it */
  run?: number;
  hash: string;
  status: 'pending' | 'approved' | 'declined' | 'invalidated';
  executing?: boolean;
  decidedBy?: string;
  decidedAt?: number;
  reason?: string;
  args: {
    speakers: { id: string; name: string; origin: string }[];
    flights: { offerId: string | null; speakerId: string; from: string; arrives: string; eur: number }[];
    hotel: { offerId: string | null; hotel: string; nights: number; checkIn: string; checkOut: string; eurPerNight: number } | null;
    flightsEur: number;
    hotelEur: number;
    totalEur: number;
  };
  evidence: { quotes: string[]; visa: { name: string; status: string; note: string }[] };
  result?: { flights: number; hotels: number; travelEur: number; refused: string[] };
};
export type ConferenceChecks = { talks: boolean; rooms: boolean; access: boolean; catering: boolean; travel: boolean; budget: boolean; risks: boolean; all: boolean };
export type TravelChecks = { visa: boolean; flights: boolean; hotels: boolean; talks: boolean; budget: boolean; passports: boolean; all: boolean };
export type PartState = 'done' | 'already' | 'missing';
export type Plan = {
  mode: Mode;
  /** the request of the current (or last) run in this setup */
  request: RequestKind;
  /** text: the person's words (open request); entry: the router's pick (decentralized) */
  run: { id: number; request: RequestKind; at: number; text?: string; entry?: string } | null;
  slots: Record<string, SlotEntry>;
  rooms: Record<string, RoomEntry>;
  access: Record<string, AccessEntry>;
  captions: Versioned<{ rooms: string[]; totalEur: number }> | null;
  catering: CateringEntry | null;
  travel: Record<string, TravelEntry>;
  visa: Record<string, VisaEntry>;
  flights: Record<string, FlightEntry>;
  hotels: Record<string, HotelEntry>;
  passportSeenBy: string[];
  costs: Partial<Record<CostDomain, CostEntry>>;
  budgetCheck: BudgetCheck | null;
  risks: Record<string, RiskEntry>;
  approvals: Approval[];
  changes: Change[];
  totals: { budgetEur: number; committedEur: number; plannedEur: number; bufferEur: number };
  stale: Stale[];
  /** what the current run did (plan parts done) */
  complete: Partial<ConferenceChecks & TravelChecks> & { all: boolean };
  /** the plan as a whole, whichever run wrote it */
  inPlan: Partial<ConferenceChecks & TravelChecks> & { all: boolean };
  /** each part the request needs: done by this run, already in the plan (an earlier run), or missing */
  parts: Record<string, PartState>;
};
/** Plan parts done: what this run wrote or confirmed, of the parts its request needs. */
export const progress = (p: Plan) => {
  const parts = Object.entries(p.parts ?? {});
  const count = (s: PartState) => parts.filter(([, v]) => v === s).length;
  return { done: count('done'), already: count('already'), missing: count('missing'), of: parts.length, all: p.complete.all, parts: p.parts ?? {} };
};

/** The name of each plan part, as the checklist and the stats show it. */
export const PART_NAME: Record<string, string> = {
  talks: 'Talks scheduled',
  rooms: 'Rooms for keynote and tracks',
  access: 'Access checked',
  stepFree: 'Only step-free rooms',
  catering: 'Caterer chosen',
  travel: 'Travel proposed',
  budget: 'Budget check',
  risks: 'Risks flagged',
  visa: 'Visa checks',
  booking: 'Booking proposed',
  flights: 'Flights',
  hotels: 'Hotels',
  passports: 'Passports only with Travel',
};

export type Submission = { id: string; track: Track; title: string; speaker: string; speakerId: string; origin: string; rating: number };
export type Speaker = { id: string; name: string; origin: string; submissionId: string; talk: string; track: Track; shortlisted: boolean; needsFlight: boolean; flightEur: number };
export type Room = { id: string; seats: number; eurPerDay: number; stepFree: boolean; inductionLoop: boolean; note?: string; availability: string | null };
export type Caterer = { id: string; eurPerPersonDay: number; vegan: boolean; glutenFree: boolean; note: string };
export type Base = {
  event: { name: string; city: string; dates: string; days: number; attendees: number; tracks: Track[]; budgetEur: number };
  submissions: Submission[];
  speakers: Speaker[];
  rooms: Room[];
  caterers: Caterer[];
  dietary: { vegetarian: string; vegan: string; glutenFree: string; basedOn: string };
  budget: { budgetEur: number; committed: { item: string; eur: number }[]; committedEur: number };
  tickets: { sold: number; forecastByEvent: number; cap: number; priceEur: number };
  sponsors: { signedEur: number; pipelineEur: number; top: string[] };
  schedule: { slots: { day: number; slot: number; time: string }[]; keynotes: { day: number; time: string; title: string }[]; tracks: Track[] };
  travel: { hotelEurPerNight: number; flightEur: Record<string, number>; local: string[] };
  captioning: { eurPerRoomDay: number; note: string };
  systems: { systems: { airline: string; hotel: string; passports: string }; latencyMs: Record<string, number>; hotelOffers: { offerId: string; hotel: string; eurPerNight: number; roomsFree: number }[]; arriveBy: string; visaRules: string };
};

const KINDS = ['event', 'submissions', 'speakers', 'rooms', 'caterers', 'dietary', 'budget', 'tickets', 'sponsors', 'schedule', 'travel', 'captioning', 'systems'] as const;
const getJson = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: ${r.status}`))));

export function useBase() {
  const [base, setBase] = useState<Base | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(KINDS.map((k) => getJson(`/planner/data/${k}`)))
      .then((all) => setBase(Object.fromEntries(KINDS.map((k, i) => [k, all[i]])) as Base))
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  return { base, error };
}

export type Plans = Record<Mode, Plan>;

/** A person decides: approve runs the stored booking on the server; decline stores the reason. */
async function decide(id: string, verb: 'approve' | 'decline', body: object) {
  const r = await fetch(`/planner/approvals/${encodeURIComponent(id)}/${verb}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error ?? `${verb} failed (${r.status})`);
  return j as { ok: true; message?: string };
}
export const approveBooking = (id: string) => decide(id, 'approve', {});
export const declineBooking = (id: string, reason: string) => decide(id, 'decline', { reason });
export const fetchPlans = (): Promise<Plans> => getJson('/planner/plan');

// ---------- formatting ----------
const LINE_NAME: Record<string, string> = { venue: 'venue', catering: 'catering', travel: 'travel', access: 'captions' };
/**
 * A budget check as a sum the room can follow:
 * "venue €38,600 + committed marketing €12,000 = €50,600 of €180,000, buffer €129,400".
 * The committed spend is the total minus the checked lines. A stale line says what the plan says now.
 */
export function checkSum(c: { lines: { domain: string; eur: number; estimate?: boolean }[]; totalEur: number; budgetEur: number; bufferEur: number }, stale: { domain: string; currentEur: number | null }[] = []) {
  const committed = c.totalEur - c.lines.reduce((s, l) => s + l.eur, 0);
  const lines = c.lines.map((l) => {
    const st = stale.find((x) => x.domain === l.domain);
    return `${LINE_NAME[l.domain] ?? l.domain} ${eur(l.eur)}${l.estimate ? ' (estimate)' : ''}${st ? ` (stale: the plan now says ${eur(st.currentEur)})` : ''}`;
  });
  return `${[...lines, `committed marketing ${eur(committed)}`].join(' + ')} = ${eur(c.totalEur)} of ${eur(c.budgetEur)}, buffer ${eur(c.bufferEur)}`;
}

export const eur = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '€0' : `€${Math.round(n).toLocaleString('en-US')}`);
export const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
