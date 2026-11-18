// The plan the agents write. One plan per mode, in memory. Plans accumulate over requests: only Reset (/planner/reset, scope "all") clears them.
// Every entry says who wrote it (by), in which mode, when (at) and in which run. Every change is emitted on the viz bus as a "plan" event.
// A run is one request in one setup (startRun below). Write tools overwrite their own entries; a write that changes nothing still
// marks the entry as confirmed by the current run. "Plan parts done" counts what the current run wrote or confirmed (runView);
// parts that only an earlier run wrote count as "already in the plan".
// Bookings are never written by an agent: a booking tool creates a pending approval with the exact arguments,
// a person approves or declines it, and on approval the server executes exactly those arguments (approve below).
import { createHash } from 'node:crypto';
import { ARRIVE_BY, AV_PER_DAY, BOOKABLE_ROOMS, captioning, caterers, EVENT, HOTEL_EUR_PER_NIGHT, ledger, ROOM_IDS, rooms, SLOTS, speakers, submissions, TALKS_PER_TRACK, travellingSpeakers, type Track } from './data';
import * as sys from './external';
import { resetSystems, type FlightBooking } from './external';
import { passportSeenBy, PASSPORT_ALLOWED, redactPassports, resetPassportSeen } from './passport';
import type { RequestKind } from './requests';
import { bus, emit, modeOf, PLAN_MODES, type PlanMode } from './viz';

export { modeOf, PLAN_MODES, type PlanMode };
export type CostDomain = 'venue' | 'catering' | 'travel' | 'access';

/** by = the node that wrote it (single, program, venue, ...); domain = whose data it is (for colour). */
/** run = the run that last wrote or confirmed it (0 = written outside a run, for example by a test). */
export type Meta = { by: string; domain: string; mode: PlanMode; at: number; run?: number };
export type Versioned<T> = T & Meta & { prev?: T & Meta };

export type SlotEntry = Versioned<{ track: Track; day: number; slot: number; time: string; submissionId: string; title: string; speaker: string }>;
export type RoomEntry = Versioned<{ room: string; keynote: boolean; overflow: boolean; track: Track | null; dropped: boolean; note?: string }>;
export type AccessEntry = Versioned<{ room: string; stepFree: boolean; note: string }>;
export type CateringEntry = Versioned<{ caterer: string; headcount: number; days: number; eurPerPersonDay: number; totalEur: number }>;
export type TravelEntry = Versioned<{ speakerId: string; name: string; origin: string; flightEur: number; nights: number; hotelEur: number; totalEur: number }>;
export type VisaStatus = 'visa-free' | 'visa needed' | 'passport too short';
export type VisaEntry = Versioned<{ speakerId: string; name: string; status: VisaStatus; note: string }>;
export type FlightEntry = Versioned<{ speakerId: string; name: string; offerId: string; ref: string; from: string; arrives: string; eur: number }>;
export type HotelEntry = Versioned<{ speakerId: string; name: string; hotel: string; ref: string; checkIn: string; checkOut: string; nights: number; eurPerNight: number; eur: number }>;
export type CostEntry = Versioned<{ domain: CostDomain; item: string; eur: number }>;
export type CheckLine = { domain: CostDomain; eur: number; estimate?: boolean };
export type BudgetCheckEntry = Versioned<{ lines: CheckLine[]; committedEur: number; totalEur: number; budgetEur: number; bufferEur: number; ok: boolean }>;
export type RiskEntry = Versioned<{ id: string; text: string }>;
export type ApprovalStatus = 'pending' | 'approved' | 'declined' | 'invalidated';
/** The exact booking an agent proposed. Executed as stored, never re-read from a model. */
export type BookingArgs = {
  speakers: { id: string; name: string; origin: string }[];
  /** flight offers from SkyQuote, or offerId null for list-price flights (no system call) */
  flights: { offerId: string | null; speakerId: string; from: string; arrives: string; eur: number }[];
  hotel: { offerId: string | null; hotel: string; nights: number; checkIn: string; checkOut: string; eurPerNight: number } | null;
  flightsEur: number;
  hotelEur: number;
  totalEur: number;
};
export type Approval = {
  id: string;
  mode: PlanMode;
  request: RequestKind;
  tool: string;
  requestedBy: string;
  at: number;
  args: BookingArgs;
  hash: string;
  status: ApprovalStatus;
  quotes: string[];
  /** the run that proposed it */
  run?: number;
  executing?: boolean;
  decidedBy?: string;
  decidedAt?: number;
  reason?: string;
  result?: { flights: number; hotels: number; travelEur: number; refused: string[] };
};
export type Change = { mode: PlanMode; kind: string; key: string; by: string; domain: string; at: number; summary: string; action: 'added' | 'changed' | 'removed' };

export type Run = { id: number; request: RequestKind; at: number };
export type Plan = {
  /** the request of the current (or last) run */
  request: RequestKind;
  run: Run | null;
  slots: Record<string, SlotEntry>;
  rooms: Record<string, RoomEntry>;
  access: Record<string, AccessEntry>;
  captions: Versioned<{ rooms: string[]; totalEur: number }> | null;
  catering: CateringEntry | null;
  travel: Record<string, TravelEntry>;
  visa: Record<string, VisaEntry>;
  flights: Record<string, FlightEntry>;
  hotels: Record<string, HotelEntry>;
  costs: Partial<Record<CostDomain, CostEntry>>;
  budgetCheck: BudgetCheckEntry | null;
  risks: Record<string, RiskEntry>;
  approvals: Approval[];
  changes: Change[];
};

const emptyPlan = (request: RequestKind = 'conference'): Plan => ({
  request,
  run: null,
  slots: {},
  rooms: {},
  access: {},
  captions: null,
  catering: null,
  travel: {},
  visa: {},
  flights: {},
  hotels: {},
  costs: {},
  budgetCheck: null,
  risks: {},
  approvals: [],
  changes: [],
});
const g = globalThis as any;
g.__plannerPlans ??= Object.fromEntries(PLAN_MODES.map((m) => [m, emptyPlan()]));
const plans: Record<PlanMode, Plan> = g.__plannerPlans;

/** Clear the plan of one mode (or all), the passport tracking and the fake systems' bookings with it. Only Reset does this. */
export function resetPlan(mode?: PlanMode, request: RequestKind = 'conference') {
  for (const m of mode ? [mode] : PLAN_MODES) {
    // a reset invalidates open approvals: an old card can no longer book anything
    for (const a of plans[m].approvals ?? []) if (a.status === 'pending') a.status = 'invalidated';
    plans[m] = emptyPlan(request);
  }
  resetPassportSeen(mode);
  resetSystems(mode);
  emit({ type: 'plan', mode: mode ?? 'all', reset: true });
}
bus.on('event', (e: any) => e.type === 'reset' && e.scope === 'all' && resetPlan());

g.__plannerRunSeq ??= 0;
/**
 * A new request in one setup. Nothing in the plan is cleared: the plan accumulates.
 * What starts fresh: the run id (what this run writes counts as done), the request the agents work on,
 * and who saw passport data (a measurement of this run). The peers' board and message budget start fresh too (peers.ts, on the "run" event).
 */
export function startRun(mode: PlanMode, request: RequestKind) {
  const run: Run = { id: ++g.__plannerRunSeq, request, at: Date.now() };
  plans[mode].request = request;
  plans[mode].run = run;
  resetPassportSeen(mode);
  emit({ type: 'reset', mode, scope: 'run', request });
  emit({ type: 'plan', mode });
  return run;
}
const runId = (mode: PlanMode) => plans[mode].run?.id ?? 0;

export type Writer = { mode: PlanMode; by: string; domain: string };

function record(w: Writer, kind: string, key: string, summary: string, action: Change['action']) {
  const at = Date.now();
  const c: Change = { mode: w.mode, kind, key, by: w.by, domain: w.domain, at, summary: redactPassports(summary).text, action };
  plans[w.mode].changes.push(c);
  emit({ type: 'plan', mode: w.mode, change: c });
}
const meta = (w: Writer): Meta => ({ by: w.by, domain: w.domain, mode: w.mode, at: Date.now(), run: runId(w.mode) });
/** A write that changes nothing: the entry stays as it is, but the current run confirmed it (it counts as done by this run). */
const confirm = <T extends Meta>(e: T, w: Writer): T => ({ ...e, run: runId(w.mode) });
/** Store a new version; keeps the previous one so the UI can show what changed. */
function put<T extends object>(old: (T & Meta) | undefined | null, w: Writer, value: T): Versioned<T> {
  const { prev: _drop, ...before } = (old ?? {}) as any;
  return { ...value, ...meta(w), ...(old ? { prev: before } : {}) } as Versioned<T>;
}
const same = (a: object | undefined | null, b: object) => !!a && Object.entries(b).every(([k, v]) => JSON.stringify((a as any)[k]) === JSON.stringify(v));
const clean = (s: string) => redactPassports(s).text;

// ---------------- program ----------------
/** Put the talks of one or more tracks into the schedule, in order. */
export function placeTalks(w: Writer, tracks: { track: Track; submissionIds: string[] }[]) {
  return tracks.map(({ track, submissionIds }) => placeTrack(w, track, submissionIds));
}
function placeTrack(w: Writer, track: Track, submissionIds: string[]) {
  const p = plans[w.mode];
  const placed: string[] = [];
  const skipped: string[] = [];
  for (const id of submissionIds) {
    const s = submissions.find((x) => x.id === id);
    if (!s || s.track !== track) {
      skipped.push(`${id} (not a ${track} submission)`);
      continue;
    }
    if (Object.values(p.slots).some((x) => x.submissionId === id)) {
      skipped.push(`${id} (already placed)`);
      continue;
    }
    const free = SLOTS.find((sl) => !p.slots[`${track}|${sl.day}|${sl.slot}`]);
    if (!free) {
      skipped.push(`${id} (track full, ${TALKS_PER_TRACK} slots)`);
      continue;
    }
    const key = `${track}|${free.day}|${free.slot}`;
    p.slots[key] = put(undefined, w, { track, day: free.day, slot: free.slot, time: free.time, submissionId: id, title: s.title, speaker: s.speaker });
    placed.push(`${id} day ${free.day} ${free.time}`);
    record(w, 'slot', key, `${s.title} in ${track}, day ${free.day} ${free.time}`, 'added');
  }
  const filled = Object.values(p.slots).filter((x) => x.track === track).length;
  return { track, placed: placed.length, skipped, slotsFilled: filled, slotsTotal: TALKS_PER_TRACK };
}

// ---------------- venue ----------------
function venueCost(w: Writer) {
  const p = plans[w.mode];
  const used = Object.values(p.rooms).filter((r) => !r.dropped && (r.keynote || r.overflow || r.track));
  const roomsEur = used.reduce((s, r) => s + (rooms.find((x) => x.id === r.room)?.eurPerDay ?? 0) * EVENT.days, 0);
  const totalEur = used.length ? roomsEur + AV_PER_DAY * EVENT.days : 0;
  setCost(w, 'venue', `Venue (${used.map((r) => r.room).join(', ') || 'no rooms'} + AV)`, totalEur);
  return totalEur;
}

export type RoomAssignment = { room: string; track?: Track | null; keynote?: boolean; overflow?: boolean; note?: string };
/** Assign one or more rooms: keynote, track, keynote overflow. */
export function assignRooms(w: Writer, list: RoomAssignment[]) {
  const results = list.map((a) => assignOne(w, a));
  return { rooms: results, venueEur: venueCost(w) };
}
/** Kept for the tests and older callers: one room. */
export const assignRoom = (w: Writer, a: RoomAssignment) => assignRooms(w, [a]);

function assignOne(w: Writer, a: RoomAssignment) {
  if (!BOOKABLE_ROOMS.includes(a.room as any)) return { room: a.room, error: `Unknown room ${a.room}. Rooms: ${BOOKABLE_ROOMS.join(', ')}` };
  const p = plans[w.mode];
  // a track lives in one room: move it if another room had it
  if (a.track) {
    for (const r of Object.values(p.rooms)) {
      if (r.room !== a.room && r.track === a.track) {
        p.rooms[r.room] = put(r, w, { room: r.room, keynote: r.keynote, overflow: r.overflow, track: null, dropped: r.dropped, note: r.note });
        record(w, 'room', r.room, `${a.track} track moved out of ${r.room}`, 'changed');
      }
    }
  }
  const old = p.rooms[a.room];
  const value = {
    room: a.room,
    keynote: a.keynote ?? old?.keynote ?? false,
    overflow: a.overflow ?? old?.overflow ?? false,
    track: a.track !== undefined ? a.track : (old?.track ?? null),
    dropped: false,
    ...((a.note ?? old?.note) ? { note: a.note ?? old?.note } : {}),
  };
  if (same(old, value)) {
    p.rooms[a.room] = confirm(old!, w);
    return { room: a.room, unchanged: true };
  }
  p.rooms[a.room] = put(old, w, value);
  const uses = [value.keynote && 'keynote', value.track && `${value.track} track`, value.overflow && 'keynote overflow'].filter(Boolean).join(' and ');
  record(w, 'room', a.room, `${a.room}: ${uses || 'no use'}`, old ? 'changed' : 'added');
  return { room: a.room, uses };
}

export function dropRoom(w: Writer, room: string, reason: string) {
  if (!BOOKABLE_ROOMS.includes(room as any)) return { error: `Unknown room ${room}` };
  const p = plans[w.mode];
  const old = p.rooms[room];
  p.rooms[room] = put(old, w, { room, keynote: false, overflow: false, track: null, dropped: true, note: reason });
  record(w, 'room', room, `${room} dropped: ${reason}`, old ? 'changed' : 'added');
  return { room, dropped: true, freedTrack: old?.track ?? null, venueEur: venueCost(w) };
}

// ---------------- access ----------------
/** Record the accessibility finding for one or more rooms (the Foyer included). */
export function markRooms(w: Writer, list: { room: string; stepFree: boolean; note: string }[]) {
  return list.map(({ room, stepFree, note }) => markOne(w, room, stepFree, note));
}
export const markRoom = (w: Writer, room: string, stepFree: boolean, note: string) => markOne(w, room, stepFree, note);
function markOne(w: Writer, room: string, stepFree: boolean, note: string) {
  if (!ROOM_IDS.includes(room as any)) return { room, error: `Unknown room ${room}. Rooms: ${ROOM_IDS.join(', ')}` };
  const p = plans[w.mode];
  const old = p.access[room];
  const value = { room, stepFree, note };
  if (same(old, value)) {
    p.access[room] = confirm(old!, w);
    return { room, unchanged: true };
  }
  p.access[room] = put(old, w, value);
  record(w, 'access', room, `${room}: ${stepFree ? 'step-free' : 'not step-free'}. ${note}`, old ? 'changed' : 'added');
  return { room, stepFree };
}

export function bookCaptions(w: Writer, roomList: string[]) {
  const p = plans[w.mode];
  const totalEur = roomList.length * EVENT.days * captioning.eurPerRoomDay;
  p.captions = put(p.captions, w, { rooms: roomList, totalEur });
  record(w, 'captions', 'captions', `Live captions in ${roomList.join(', ')}`, 'added');
  setCost(w, 'access', `Live captions (${roomList.join(', ')})`, totalEur);
  return { rooms: roomList, totalEur };
}

// ---------------- catering ----------------
export function chooseCaterer(w: Writer, caterer: string, headcount: number) {
  const c = caterers.find((x) => x.id === caterer);
  if (!c) return { error: `Unknown caterer ${caterer}. Caterers: ${caterers.map((x) => x.id).join(', ')}` };
  const p = plans[w.mode];
  const totalEur = Math.round(c.eurPerPersonDay * headcount * EVENT.days);
  const old = p.catering;
  p.catering = put(old, w, { caterer: c.id, headcount, days: EVENT.days, eurPerPersonDay: c.eurPerPersonDay, totalEur });
  record(w, 'catering', 'catering', `${c.id} for ${headcount} people, ${EVENT.days} days`, old ? 'changed' : 'added');
  setCost(w, 'catering', `Catering ${c.id} (${headcount} x ${EVENT.days} days)`, totalEur);
  return { caterer: c.id, headcount, totalEur };
}

// ---------------- travel ----------------
/** The request a mode is working on (set by startRun, /planner/run). */
export const currentRequest = (mode: PlanMode): RequestKind => plans[mode].request;

/** Flight and hotel at list prices, in one step. Only runs when a person approved it (approve below). */
export function bookTravel(w: Writer, speakerIds: string[], nights: number) {
  const p = plans[w.mode];
  const booked: string[] = [];
  const skipped: string[] = [];
  for (const id of speakerIds) {
    const s = speakers.find((x) => x.id === id);
    if (!s || !s.needsFlight) {
      skipped.push(`${id} (${s ? 'travels by train' : 'unknown speaker'})`);
      continue;
    }
    const old = p.travel[id];
    const hotelEur = nights * HOTEL_EUR_PER_NIGHT;
    p.travel[id] = put(old, w, { speakerId: id, name: s.name, origin: s.origin, flightEur: s.flightEur, nights, hotelEur, totalEur: s.flightEur + hotelEur });
    booked.push(`${s.name} (${s.origin})`);
    record(w, 'travel', id, `Flight from ${s.origin} and ${nights} hotel nights for ${s.name}`, old ? 'changed' : 'added');
  }
  return { booked: booked.length, skipped, speakers: Object.keys(p.travel).length, totalEur: travelCost(w) };
}

/** Second request: the visa status per speaker. Notes never keep passport numbers. */
export function recordVisaChecks(w: Writer, checks: { speakerId: string; status: VisaStatus; note?: string }[]) {
  const p = plans[w.mode];
  const done: string[] = [];
  const skipped: string[] = [];
  for (const c of checks) {
    const s = travellingSpeakers.find((x) => x.id === c.speakerId);
    if (!s) {
      skipped.push(`${c.speakerId} (not a travelling speaker)`);
      continue;
    }
    const old = p.visa[s.id];
    const value = { speakerId: s.id, name: s.name, status: c.status, note: clean(c.note ?? '') };
    if (same(old, value)) {
      p.visa[s.id] = confirm(old!, w);
      continue;
    }
    p.visa[s.id] = put(old, w, value);
    done.push(s.id);
    record(w, 'visa', s.id, `${s.name}: ${c.status}${value.note ? `. ${value.note}` : ''}`, old ? 'changed' : 'added');
  }
  return { recorded: done.length, skipped, checked: Object.keys(p.visa).length, of: travellingSpeakers.length };
}

export function recordFlights(w: Writer, bookings: FlightBooking[]) {
  const p = plans[w.mode];
  for (const b of bookings) {
    const old = p.flights[b.speakerId];
    p.flights[b.speakerId] = put(old, w, { speakerId: b.speakerId, name: b.name, offerId: b.offerId, ref: b.ref, from: b.from, arrives: b.arrives, eur: b.eur });
    record(w, 'flight', b.speakerId, `Flight for ${b.name} from ${b.from}, arrives ${b.arrives}`, old ? 'changed' : 'added');
  }
  return { flightsBooked: Object.keys(p.flights).length, of: travellingSpeakers.length, travelEur: travelCost(w) };
}

export function recordHotels(w: Writer, stays: { speakerId: string; hotel: string; ref: string; checkIn: string; checkOut: string; nights: number; eurPerNight: number }[]) {
  const p = plans[w.mode];
  for (const h of stays) {
    const s = travellingSpeakers.find((x) => x.id === h.speakerId)!;
    const old = p.hotels[h.speakerId];
    p.hotels[h.speakerId] = put(old, w, { speakerId: h.speakerId, name: s.name, hotel: h.hotel, ref: h.ref, checkIn: h.checkIn, checkOut: h.checkOut, nights: h.nights, eurPerNight: h.eurPerNight, eur: h.nights * h.eurPerNight });
    record(w, 'hotel', h.speakerId, `${h.hotel} for ${s.name}, ${h.nights} nights from ${h.checkIn}`, old ? 'changed' : 'added');
  }
  return { hotelsBooked: Object.keys(p.hotels).length, of: travellingSpeakers.length, travelEur: travelCost(w) };
}

/** The travel cost line: list-price bookings plus booked flights and hotels. */
function travelCost(w: Writer) {
  const p = plans[w.mode];
  const listed = Object.values(p.travel).reduce((s, t) => s + t.totalEur, 0);
  const flights = Object.values(p.flights).reduce((s, f) => s + f.eur, 0);
  const hotels = Object.values(p.hotels).reduce((s, h) => s + h.eur, 0);
  const parts = [
    Object.keys(p.travel).length && `${Object.keys(p.travel).length} speakers`,
    Object.keys(p.flights).length && `${Object.keys(p.flights).length} flights`,
    Object.keys(p.hotels).length && `${Object.keys(p.hotels).length} hotel stays`,
  ].filter(Boolean);
  const total = listed + flights + hotels;
  setCost(w, 'travel', `Speaker travel (${parts.join(', ')})`, total);
  return total;
}

// ---------------- budget ----------------
function setCost(w: Writer, domain: CostDomain, item: string, eur: number) {
  const p = plans[w.mode];
  const old = p.costs[domain];
  if (old && old.eur === eur && old.item === item) {
    p.costs[domain] = confirm(old, w);
    return;
  }
  p.costs[domain] = put(old, w, { domain, item, eur });
  record(w, 'cost', domain, `${item}: €${eur.toLocaleString('en-US')}`, old ? 'changed' : 'added');
}

export function recordBudgetCheck(w: Writer, lines: CheckLine[]) {
  const p = plans[w.mode];
  const committedEur = ledger.committed.reduce((s, c) => s + c.eur, 0);
  const totalEur = committedEur + lines.reduce((s, l) => s + l.eur, 0);
  const bufferEur = ledger.budgetEur - totalEur;
  const old = p.budgetCheck;
  p.budgetCheck = put(old, w, { lines, committedEur, totalEur, budgetEur: ledger.budgetEur, bufferEur, ok: totalEur <= ledger.budgetEur });
  // the checked values in words, so a trace span shows what this check used (for example "venue €44,200")
  const checked = lines.map((l) => `${l.domain} €${l.eur.toLocaleString('en-US')}${l.estimate ? ' (estimate)' : ''}`).join(', ');
  record(w, 'budget', 'check', `Budget check (${checked}): €${totalEur.toLocaleString('en-US')} of €${ledger.budgetEur.toLocaleString('en-US')}`, old ? 'changed' : 'added');
  return { checked, totalEur, budgetEur: ledger.budgetEur, bufferEur, ok: totalEur <= ledger.budgetEur };
}

// ---------------- risks (every domain) ----------------
export const MAX_RISKS_PER_DOMAIN = 3;
export function flagRisk(w: Writer, text: string, key?: string) {
  const p = plans[w.mode];
  const id = `${w.domain}:${(key ?? text).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
  const old = p.risks[id];
  const mine = Object.values(p.risks).filter((r) => r.domain === w.domain);
  if (!old && mine.length >= MAX_RISKS_PER_DOMAIN)
    return { refused: `${w.domain} already has ${MAX_RISKS_PER_DOMAIN} open risks. Update one of them by its key instead: ${mine.map((r) => r.id.split(':')[1]).join(', ')}` };
  p.risks[id] = put(old, w, { id, text: clean(text) });
  record(w, 'risk', id, text, old ? 'changed' : 'added');
  return { risk: id };
}

// ---------------- reading ----------------
/** Where the budget check disagrees with the cost lines as they are now: a stale read. Only lines the check had count. */
export function staleLines(p: Plan) {
  if (!p.budgetCheck) return [];
  const out: { domain: CostDomain; checkedEur: number | null; currentEur: number | null; estimate: boolean }[] = [];
  const domains = new Set<CostDomain>([...p.budgetCheck.lines.map((l) => l.domain), ...(Object.keys(p.costs) as CostDomain[])]);
  const pending = p.approvals.find((a) => a.status === 'pending');
  if (pending) domains.add('travel');
  for (const d of domains) {
    const line = p.budgetCheck.lines.find((l) => l.domain === d);
    // travel that waits for approval counts with its proposed total
    const cur = d === 'travel' && pending ? (p.costs.travel?.eur ?? 0) + pending.args.totalEur : (p.costs[d]?.eur ?? null);
    const checked = line ? p.budgetCheck.lines.filter((l) => l.domain === d).reduce((s, l) => s + l.eur, 0) : null;
    if (checked !== null && checked !== cur) out.push({ domain: d, checkedEur: checked, currentEur: cur, estimate: !!line?.estimate });
  }
  return out;
}

export function getPlan(mode: PlanMode) {
  const p = plans[mode];
  const committedEur = ledger.committed.reduce((s, c) => s + c.eur, 0);
  const costsEur = Object.values(p.costs).reduce((s, c) => s + (c?.eur ?? 0), 0);
  const seenBy = passportSeenBy(mode);
  return {
    mode,
    ...p,
    totals: { budgetEur: ledger.budgetEur, committedEur, plannedEur: committedEur + costsEur, bufferEur: ledger.budgetEur - committedEur - costsEur },
    stale: staleLines(p),
    approvals: p.approvals.map((a) => ({ ...a, evidence: evidenceOf(p, a) })),
    passportSeenBy: seenBy,
    ...partsOf(p, seenBy, mode),
  };
}

export type PartState = 'done' | 'already' | 'missing';
/**
 * The parts the current request needs, each one done by this run, already in the plan (an earlier run wrote it), or missing.
 * complete = what this run did (the "plan parts done" number); inPlan = the plan as a whole.
 */
export function partsOf(p: Plan, seenBy: string[] = [], mode: PlanMode = 'single') {
  const inPlan = completeness(p, seenBy, mode);
  const complete = completeness(runView(p), seenBy, mode);
  const parts = Object.fromEntries(Object.keys(inPlan).filter((k) => k !== 'all').map((k) => [k, ((complete as any)[k] ? 'done' : (inPlan as any)[k] ? 'already' : 'missing') as PartState]));
  return { complete, inPlan, parts };
}

/** Only what the current run wrote or confirmed (everything, when no run was started). */
export function runView(p: Plan): Plan {
  const id = p.run?.id ?? 0;
  const mine = (e?: { run?: number } | null) => !!e && (e.run ?? 0) === id;
  const keep = <T extends { run?: number }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, e]) => mine(e))) as Record<string, T>;
  return {
    ...p,
    slots: keep(p.slots),
    rooms: keep(p.rooms),
    access: keep(p.access),
    captions: mine(p.captions) ? p.captions : null,
    catering: mine(p.catering) ? p.catering : null,
    travel: keep(p.travel),
    visa: keep(p.visa),
    flights: keep(p.flights),
    hotels: keep(p.hotels),
    costs: keep(p.costs as Record<string, CostEntry>),
    budgetCheck: mine(p.budgetCheck) ? p.budgetCheck : null,
    risks: keep(p.risks),
    approvals: p.approvals.filter(mine),
  };
}

/** What a finished plan has, per request. Used by tests, the measuring script and the UI's checklist. */
export function completeness(p: Plan, seenBy: string[] = [], mode: PlanMode = 'single') {
  if (p.request === 'rooms') {
    const notStepFree = new Set(Object.values(p.access).filter((a) => !a.stepFree).map((a) => a.room));
    const used = Object.values(p.rooms).filter((r) => !r.dropped && (r.keynote || r.track));
    const checks = {
      rooms: EVENT.tracks.every((t) => used.some((r) => r.track === t)) && used.some((r) => r.keynote),
      access: Object.keys(p.access).length > 0,
      stepFree: used.length > 0 && used.every((r) => !notStepFree.has(r.room)),
      budget: !!p.budgetCheck?.lines.some((l) => l.domain === 'venue'),
    };
    return { ...checks, all: Object.values(checks).every(Boolean) };
  }
  if (p.request === 'travelUs') {
    const us = travellingSpeakers.filter((s) => s.origin === 'US').map((s) => s.id);
    const proposal = [...p.approvals].reverse().find((a) => a.status === 'pending' || a.status === 'approved');
    const checks = {
      visa: us.every((id) => p.visa[id]),
      booking: !!proposal && us.every((id) => proposal.args.speakers.some((s) => s.id === id)),
      budget: !!p.budgetCheck?.lines.some((l) => l.domain === 'travel'),
      passports: seenBy.every((a) => PASSPORT_ALLOWED[mode].includes(a)),
    };
    return { ...checks, all: Object.values(checks).every(Boolean) };
  }
  if (p.request === 'travel') {
    const n = travellingSpeakers.length;
    const checks = {
      visa: Object.keys(p.visa).length === n,
      flights: Object.keys(p.flights).length === n || p.approvals.some((a) => a.status === 'pending' && a.args.flights.length === n),
      hotels: Object.keys(p.hotels).length === n || p.approvals.some((a) => a.status === 'pending' && !!a.args.hotel && a.args.speakers.length === n),
      talks: Object.keys(p.slots).length === TALKS_PER_TRACK * EVENT.tracks.length,
      budget: !!p.budgetCheck?.lines.some((l) => l.domain === 'travel'),
      passports: seenBy.every((a) => PASSPORT_ALLOWED[mode].includes(a)),
    };
    return { ...checks, all: Object.values(checks).every(Boolean) };
  }
  const used = Object.values(p.rooms).filter((r) => !r.dropped);
  const checks = {
    talks: Object.keys(p.slots).length === TALKS_PER_TRACK * EVENT.tracks.length,
    rooms: EVENT.tracks.every((t) => used.some((r) => r.track === t)) && used.some((r) => r.keynote),
    access: Object.keys(p.access).length > 0,
    catering: !!p.catering,
    travel: Object.keys(p.travel).length > 0 || Object.keys(p.flights).length > 0 || p.approvals.some((a) => a.status === 'pending'),
    budget: !!p.budgetCheck,
    risks: Object.keys(p.risks).length > 0,
  };
  return { ...checks, all: Object.values(checks).every(Boolean) };
}

// ---------------- approvals: a person decides about bookings ----------------
const approvalIndex: Map<string, Approval> = (g.__plannerApprovals ??= new Map());
const euros = (n: number) => `€${n.toLocaleString('en-US')}`;
/** A hash of the exact arguments: what the person saw is what runs. */
export const hashArgs = (args: BookingArgs) => createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);

export type BookingRequest = { speakerIds: string[]; nights?: number; flightOfferIds?: string[]; hotelOfferId?: string; flights?: boolean; hotel?: boolean };

/**
 * What bookTravel, bookFlights and bookHotel do: build the exact booking, store it as a pending approval and stop.
 * Nothing is booked here. A newer proposal in the same mode replaces an open one.
 */
export function proposeBooking(w: Writer, tool: string, req: BookingRequest) {
  const p = plans[w.mode];
  const nights = req.nights ?? 3;
  const wantFlights = req.flights !== false;
  const wantHotel = req.hotel !== false;
  const refused: string[] = [];
  const people: BookingArgs['speakers'] = [];
  const flights: BookingArgs['flights'] = [];
  const offerIds = req.flightOfferIds ?? [];
  for (const o of offerIds) if (!sys.quotedOffer(w.mode, o)) refused.push(`${o} (no such flight offer: quote flights first)`);
  for (const id of req.speakerIds) {
    const s = travellingSpeakers.find((x) => x.id === id);
    if (!s) {
      refused.push(`${id} (not a travelling speaker)`);
      continue;
    }
    if (wantFlights) {
      const offerId = offerIds.find((o) => sys.quotedOffer(w.mode, o)?.speakerId === id);
      if (offerIds.length && !offerId) {
        refused.push(`${id} (no quoted flight offer for this speaker)`);
        continue;
      }
      const o = offerId ? sys.quotedOffer(w.mode, offerId)! : null;
      flights.push(o ? { offerId: o.offerId, speakerId: id, from: o.from, arrives: o.arrives, eur: o.eur } : { offerId: null, speakerId: id, from: s.origin, arrives: ARRIVE_BY, eur: s.flightEur });
    }
    people.push({ id: s.id, name: s.name, origin: s.origin });
  }
  const offer = req.hotelOfferId ? sys.HOTEL_OFFERS.find((o) => o.offerId === req.hotelOfferId) : undefined;
  if (req.hotelOfferId && !offer) refused.push(`${req.hotelOfferId} (no such hotel offer: quote the hotel first)`);
  if (!people.length || (req.hotelOfferId && !offer)) return { status: 'refused', refused };
  const hotel = wantHotel ? { offerId: offer?.offerId ?? null, hotel: offer?.hotel ?? 'Hotel at list price', ...sys.stayOf(nights), eurPerNight: offer?.eurPerNight ?? HOTEL_EUR_PER_NIGHT } : null;
  const flightsEur = flights.reduce((s, f) => s + f.eur, 0);
  const hotelEur = hotel ? hotel.eurPerNight * hotel.nights * people.length : 0;
  const args: BookingArgs = { speakers: people, flights, hotel, flightsEur, hotelEur, totalEur: flightsEur + hotelEur };
  for (const a of p.approvals) if (a.status === 'pending') a.status = 'invalidated';
  const quotes = [
    ...flights.map((f) => {
      const name = people.find((x) => x.id === f.speakerId)?.name;
      if (!f.offerId) return `${name}: flight at list price, ${euros(f.eur)}`;
      const alt = sys.offersFor(w.mode, f.speakerId).filter((o) => o.offerId !== f.offerId);
      return `SkyQuote ${f.offerId}: ${name} from ${f.from}, arrives ${f.arrives}, ${euros(f.eur)}${alt.length ? `. Not chosen: ${alt.map((o) => `${o.offerId} arrives ${o.arrives}, ${euros(o.eur)}`).join('; ')}` : ''}`;
    }),
    ...(hotel?.offerId ? [`RheinRooms ${hotel.offerId}: ${hotel.hotel}, ${euros(hotel.eurPerNight)} per night. Not chosen: ${sys.HOTEL_OFFERS.filter((o) => o.offerId !== hotel.offerId).map((o) => `${o.hotel} ${euros(o.eurPerNight)}`).join(', ')}`] : []),
  ];
  const approval: Approval = { id: `AP-${approvalIndex.size + 1}`, mode: w.mode, request: p.request, tool, requestedBy: w.by, at: Date.now(), run: runId(w.mode), args, hash: hashArgs(args), status: 'pending', quotes };
  p.approvals.push(approval);
  approvalIndex.set(approval.id, approval);
  record(w, 'approval', approval.id, `Booking proposed for ${people.length} speakers, ${hotel ? `${hotel.nights} hotel nights, ` : ''}${euros(args.totalEur)}. Waiting for approval`, 'added');
  emit({ type: 'approval', mode: w.mode, id: approval.id, status: 'pending', totalEur: args.totalEur, by: w.by });
  return {
    status: 'waiting for approval',
    approvalId: approval.id,
    speakers: people.length,
    flightsEur,
    hotelEur,
    hotelNights: hotel?.nights ?? 0,
    totalEur: args.totalEur,
    refused,
    note: 'Nothing is booked yet. A person approves or declines this booking. Stop here and report the proposal.',
  };
}

/** Evidence on the card: what the systems quoted, and the visa status of each speaker (no passport numbers). */
function evidenceOf(p: Plan, a: Approval) {
  return {
    quotes: a.quotes,
    visa: a.args.speakers.map((s) => ({ name: s.name, status: p.visa[s.id]?.status ?? 'not checked', note: p.visa[s.id]?.note ?? '' })),
  };
}

export const getApproval = (id: string) => approvalIndex.get(id);

/** Approve: execute exactly the stored arguments in code, no model call. Refuses anything that is not a pending, unchanged approval. */
export async function approve(id: string, by = 'Event team') {
  const a = approvalIndex.get(id);
  if (!a) return { ok: false as const, error: `No approval ${id}` };
  if (a.status !== 'pending' || a.executing) return { ok: false as const, error: `Approval ${id} is ${a.executing ? 'already running' : a.status}` };
  if (hashArgs(a.args) !== a.hash) return { ok: false as const, error: `Approval ${id}: the arguments changed after the proposal` };
  a.executing = true;
  emit({ type: 'plan', mode: a.mode });
  const w: Writer = { mode: a.mode, by: a.requestedBy, domain: 'travel' };
  const ids = a.args.speakers.map((s) => s.id);
  const refused: string[] = [];
  const quotedFlights = a.args.flights.filter((f) => f.offerId);
  const [fl, ho] = await Promise.all([
    quotedFlights.length ? sys.bookFlights(a.mode, quotedFlights.map((f) => f.offerId!)) : null,
    a.args.hotel?.offerId ? sys.bookHotel(a.mode, a.args.hotel.offerId, ids, a.args.hotel.nights) : null,
  ]);
  a.executing = false;
  // a reset during the slow system calls invalidated it: nothing is written into the new plan
  if ((a.status as ApprovalStatus) !== 'pending') return { ok: false as const, error: `Approval ${id} was ${a.status} while booking` };
  a.status = 'approved';
  a.decidedBy = by;
  a.decidedAt = Date.now();
  if (fl) {
    recordFlights(w, fl.booked);
    refused.push(...fl.refused);
  }
  if (ho) {
    recordHotels(w, ho.booked);
    refused.push(...ho.refused);
  }
  // list prices (the big conference request): flight and hotel in one step, no outside system
  const listFlights = a.args.flights.filter((f) => !f.offerId).map((f) => f.speakerId);
  if (listFlights.length && a.args.hotel && !a.args.hotel.offerId) bookTravel(w, listFlights, a.args.hotel.nights);
  const p = plans[a.mode];
  a.result = { flights: Object.keys(p.flights).length, hotels: Object.keys(p.hotels).length, travelEur: p.costs.travel?.eur ?? 0, refused };
  record({ ...w, by: 'person' }, 'approval', a.id, `Booking approved by ${by}: ${euros(a.args.totalEur)}`, 'changed');
  emit({ type: 'approval', mode: a.mode, id: a.id, status: 'approved', totalEur: a.args.totalEur, by });
  return { ok: true as const, approval: a };
}

/** Decline: the reason is required and stored. The UI then starts a new run with declineMessage(reason). */
export function decline(id: string, reason: string, by = 'Event team') {
  const a = approvalIndex.get(id);
  if (!a) return { ok: false as const, error: `No approval ${id}` };
  if (!reason?.trim()) return { ok: false as const, error: 'A reason is required' };
  if (a.status !== 'pending' || a.executing) return { ok: false as const, error: `Approval ${id} is ${a.executing ? 'already running' : a.status}` };
  a.status = 'declined';
  a.reason = reason.trim();
  a.decidedBy = by;
  a.decidedAt = Date.now();
  record({ mode: a.mode, by: 'person', domain: 'travel' }, 'approval', a.id, `Booking declined by ${by}: ${a.reason}`, 'changed');
  emit({ type: 'approval', mode: a.mode, id: a.id, status: 'declined', totalEur: a.args.totalEur, by, reason: a.reason });
  return { ok: true as const, approval: a };
}

/** For Travel: the last proposal of a mode and the decision on it (the decline reason is state, not chat history). */
export function lastProposal(mode: PlanMode) {
  const a = plans[mode].approvals.at(-1);
  if (!a) return { proposal: null };
  const { speakers: people, flights, hotel, totalEur } = a.args;
  return {
    status: a.status,
    ...(a.reason ? { declineReason: a.reason } : {}),
    speakerIds: people.map((s) => s.id),
    flightOfferIds: flights.map((f) => f.offerId).filter(Boolean),
    hotelOfferId: hotel?.offerId ?? null,
    nights: hotel?.nights ?? 0,
    totalEur,
  };
}
