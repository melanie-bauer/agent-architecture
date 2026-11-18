// Fake outside systems for the second request ("Book speaker travel"). Fictional, and labelled that way in the UI.
//   SkyQuote    fake airline system: quote flights, then book chosen offers
//   RheinRooms  fake hotel system: quote rooms for booked arrivals, then book
// Each call waits like a slow outside API would. The wait applies in live AND mock mode, so mock runs show the same waiting.
// PLANNER_SYSTEM_LATENCY scales it (1 = as listed below, 0 = no wait; the tests use a small value).
// A booking needs an offer from a quote. Bookings run only after a person approved them (plan-store.ts, approvals);
// every call takes a batch, so the four US speakers cost one call per system.
import { ARRIVE_BY, travellingSpeakers } from './data';
import { bus, PLAN_MODES, type PlanMode } from './viz';

export const SYSTEMS = {
  airline: 'SkyQuote, fake airline system',
  hotel: 'RheinRooms, fake hotel system',
  passports: 'Passport registry, fake',
} as const;
export const SYSTEM_LATENCY_MS = { quoteFlights: 4000, bookFlights: 2500, quoteHotel: 4000, bookHotel: 2500, readPassports: 1500 } as const;

const scale = () => {
  const raw = process.env.PLANNER_SYSTEM_LATENCY;
  const v = raw === undefined || raw === '' ? 1 : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 1;
};
export const systemWait = (call: keyof typeof SYSTEM_LATENCY_MS) => new Promise((r) => setTimeout(r, SYSTEM_LATENCY_MS[call] * scale()));

export type FlightOffer = { offerId: string; speakerId: string; name: string; from: string; arrives: string; stops: number; eur: number };
export type FlightBooking = FlightOffer & { ref: string };
export type HotelOffer = { offerId: string; hotel: string; eurPerNight: number; roomsFree: number };

// each mode has its own bookings in the fake systems, cleared with the plan of that mode
type Db = { offers: Map<string, FlightOffer>; flights: Map<string, FlightBooking>; hotelQuotes: Map<string, Set<string>> };
const g = globalThis as any;
g.__plannerSystems ??= Object.fromEntries(PLAN_MODES.map((m) => [m, { offers: new Map(), flights: new Map(), hotelQuotes: new Map() }]));
const db: Record<PlanMode, Db> = g.__plannerSystems;
export function resetSystems(mode?: PlanMode) {
  for (const m of mode ? [mode] : PLAN_MODES) db[m] = { offers: new Map(), flights: new Map(), hotelQuotes: new Map() };
}
bus.on('event', (e: any) => e.type === 'reset' && e.scope === 'all' && resetSystems());

const speaker = (id: string) => travellingSpeakers.find((s) => s.id === id);
const AIRPORT: Record<string, string> = { US: 'New York JFK', UK: 'London Heathrow', NL: 'Amsterdam', PL: 'Warsaw', IN: 'Bengaluru', BR: 'São Paulo' };

/** SkyQuote: two offers per speaker. A arrives on 10 May, B is cheaper but lands on the first conference morning. */
export async function quoteFlights(mode: PlanMode, speakerIds: string[]) {
  await systemWait('quoteFlights');
  const offers: FlightOffer[] = [];
  const unknown: string[] = [];
  for (const id of speakerIds) {
    const s = speaker(id);
    if (!s) {
      unknown.push(id);
      continue;
    }
    const a: FlightOffer = { offerId: `SQ-${id}-A`, speakerId: id, name: s.name, from: AIRPORT[s.origin] ?? s.origin, arrives: `${ARRIVE_BY} 15:40`, stops: s.origin === 'US' || s.origin === 'IN' || s.origin === 'BR' ? 1 : 0, eur: s.flightEur };
    const b: FlightOffer = { ...a, offerId: `SQ-${id}-B`, arrives: '2027-05-11 08:35', stops: a.stops + 1, eur: Math.round((s.flightEur * 0.8) / 10) * 10 };
    for (const o of [a, b]) db[mode].offers.set(o.offerId, o);
    offers.push(a, b);
  }
  return { system: SYSTEMS.airline, offers, unknownSpeakers: unknown, rule: `Speakers must arrive by ${ARRIVE_BY}.` };
}

export async function bookFlights(mode: PlanMode, offerIds: string[]) {
  await systemWait('bookFlights');
  const booked: FlightBooking[] = [];
  const refused: string[] = [];
  for (const id of offerIds) {
    const o = db[mode].offers.get(id);
    if (!o) {
      refused.push(`${id} (no such offer: quote flights first)`);
      continue;
    }
    const b = { ...o, ref: `SQB-${o.speakerId.slice(3)}${o.offerId.slice(-1)}` };
    db[mode].flights.set(o.speakerId, b);
    booked.push(b);
  }
  return { system: SYSTEMS.airline, booked, refused };
}

export const HOTEL_OFFERS: HotelOffer[] = [
  { offerId: 'RR-AMRHEIN', hotel: 'Hotel am Rhein', eurPerNight: 200, roomsFree: 20 },
  { offerId: 'RR-RHEINBLICK', hotel: 'Rheinblick Suites', eurPerNight: 240, roomsFree: 30 },
];

const plusDays = (day: string, n: number) => new Date(Date.parse(day) + n * 86_400_000).toISOString().slice(0, 10);
/** Check-in on the arrival day (10 May), check-out after the given number of nights. */
export const stayOf = (nights: number) => ({ checkIn: ARRIVE_BY, checkOut: plusDays(ARRIVE_BY, nights), nights });

/** RheinRooms: offers for a number of nights from the arrival day (10 May). One call for every speaker. */
export async function quoteHotel(mode: PlanMode, speakerIds: string[], nights = 3) {
  await systemWait('quoteHotel');
  const known = speakerIds.filter((id) => speaker(id));
  const unknown = speakerIds.filter((id) => !speaker(id));
  const stay = stayOf(nights);
  for (const o of HOTEL_OFFERS) db[mode].hotelQuotes.set(o.offerId, new Set([...(db[mode].hotelQuotes.get(o.offerId) ?? []), ...known]));
  return { system: SYSTEMS.hotel, offers: HOTEL_OFFERS.map((o) => ({ ...o, nights, eurPerGuest: o.eurPerNight * nights, eurAll: o.eurPerNight * nights * known.length })), stay, guests: known.length, unknownSpeakers: unknown };
}

export async function bookHotel(mode: PlanMode, offerId: string, speakerIds: string[], nights = 3) {
  await systemWait('bookHotel');
  const offer = HOTEL_OFFERS.find((o) => o.offerId === offerId);
  const quoted = db[mode].hotelQuotes.get(offerId);
  if (!offer || !quoted) return { system: SYSTEMS.hotel, booked: [], refused: speakerIds.map((id) => `${id} (no quote for ${offerId}: quote the hotel first)`) };
  const booked: { speakerId: string; hotel: string; checkIn: string; checkOut: string; nights: number; eurPerNight: number; ref: string }[] = [];
  const refused: string[] = [];
  const stay = stayOf(nights);
  for (const id of speakerIds.slice(0, offer.roomsFree)) {
    if (!quoted.has(id)) {
      refused.push(`${id} (not in the quote: quote the hotel for this speaker first)`);
      continue;
    }
    booked.push({ speakerId: id, hotel: offer.hotel, ...stay, eurPerNight: offer.eurPerNight, ref: `RRB-${id.slice(3)}` });
  }
  for (const id of speakerIds.slice(offer.roomsFree)) refused.push(`${id} (${offer.hotel} has only ${offer.roomsFree} rooms free)`);
  return { system: SYSTEMS.hotel, booked, refused };
}

/** What the systems quoted in this mode (evidence for an approval card). */
export const quotedOffer = (mode: PlanMode, offerId: string) => db[mode].offers.get(offerId);
export const offersFor = (mode: PlanMode, speakerId: string) => [...db[mode].offers.values()].filter((o) => o.speakerId === speakerId);
