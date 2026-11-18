// Domain tools, grouped by the specialist that owns the data.
// Read tools look at the base data. Write tools record decisions in the plan store (plan-store.ts), attributed to the agent that wrote them.
// Every specialist and peer gets only its own domain's tools. The single agent gets all of them.
// Write tools take lists, so one call can record several decisions (fewer model steps).
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AV_PER_DAY, availability, BOOKABLE_ROOMS, captioning, caterers, dietary, EVENT, HOTEL_EUR_PER_NIGHT, internationalSpeakers, ledger, passports, ROOM_IDS, rooms, shortlist, SLOTS, sponsors, submissions, tickets, travellingSpeakers, VISA_RULES, type Track } from './data';
import * as sys from './external';
import * as plan from './plan-store';
import { emit, modeOf, nodeOf, vizId } from './viz';

export type Domain = 'program' | 'venue' | 'catering' | 'travel' | 'budget' | 'marketing' | 'access';
export const DOMAINS: Domain[] = ['program', 'venue', 'catering', 'travel', 'budget', 'marketing', 'access'];

const summarize = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
};
/** The full result for the activity log, cut off when it is very long. */
const capped = (v: unknown) => (JSON.stringify(v ?? null).length > 6000 ? { truncated: true, preview: JSON.stringify(v).slice(0, 6000) } : v);

/** Wraps a tool so every call shows up in the visualisation, attributed to its owner agent and tagged with its mode. */
function vizTool<I extends z.ZodTypeAny>(owner: string, id: string, description: string, inputSchema: I, run: (i: z.infer<I>) => unknown, system?: string) {
  return createTool({
    id,
    description,
    inputSchema,
    execute: async (input: any) => {
      const node = nodeOf(owner) ?? owner;
      const mode = modeOf(owner);
      const callId = vizId();
      const t0 = Date.now();
      emit({ type: 'tool', mode, agent: node, tool: id, args: input, id: callId });
      const out = await run(input);
      emit({ type: 'tool-result', mode, agent: node, tool: id, id: callId, summary: summarize(out), result: capped(out), ms: Date.now() - t0, ...(system ? { system } : {}) });
      return out as any;
    },
  });
}

const euro = (n: number) => Math.round(n);
const TRACK = z.enum(EVENT.tracks as [Track, ...Track[]]);

const APPROVAL_NOTE = 'Nothing is booked by this call: it creates a pending approval with the exact arguments and returns "waiting for approval". A person approves or declines it. Then stop.';
const flagRiskDescription = 'WRITE: add an open risk to the plan (one short sentence). At most 3 risks per domain: flag only the important ones, and use a stable key to update a risk instead of adding a new one.';

/** Read + write tools of one domain (a specialist or peer gets exactly this). */
export function domainTools(domain: Domain, owner: string) {
  const flagRisk = vizTool(owner, 'flagRisk', flagRiskDescription, z.object({ text: z.string(), key: z.string().optional() }), ({ text, key }: { text: string; key?: string }) =>
    plan.flagRisk(writer(owner, domain), text, key),
  );
  return { ...ownTools(domain, owner), flagRisk };
}

/** Who writes: the mode comes from the agent id (planner-single, spec-*, peer-*), the domain from the tool. */
const writer = (owner: string, domain: Domain): plan.Writer => ({ mode: plan.modeOf(owner), by: nodeOf(owner) ?? owner, domain });

function ownTools(domain: Domain, owner: string) {
  const t = <I extends z.ZodTypeAny>(id: string, d: string, s: I, r: (i: z.infer<I>) => unknown, system?: string) => vizTool(owner, id, d, s, r, system);
  const w = (d: Domain) => writer(owner, d);
  const mode = modeOf(owner);
  switch (domain) {
    case 'program':
      return {
        listSubmissions: t('listSubmissions', 'All CFP submissions with track, rating, speaker and speaker origin', z.object({ track: z.string().optional() }), ({ track }) =>
          submissions.filter((s) => !track || s.track === track).map(({ id, track, title, speaker, origin, rating }) => ({ id, track, title, speaker, origin, rating })),
        ),
        shortlistTalks: t('shortlistTalks', 'Top-rated talks per track for a number of slots', z.object({ slotsPerTrack: z.number() }), ({ slotsPerTrack }) =>
          shortlist(slotsPerTrack).map((x) => ({ track: x.track, talks: x.talks.map((s) => `${s.id} ${s.title} (${s.speaker}, ${s.origin})`) })),
        ),
        draftSchedule: t('draftSchedule', 'Draft a 2-day schedule skeleton given keynote room and track rooms (one room per track, in track order)', z.object({ keynoteRoom: z.string(), trackRooms: z.array(z.string()) }), ({ keynoteRoom, trackRooms }) => ({
          day1: [`09:00 Opening keynote (${keynoteRoom})`, ...trackRooms.map((r, i) => `10:30 to 17:00 ${EVENT.tracks[i]} track in ${r}`)],
          day2: [...trackRooms.map((r, i) => `09:00 to 15:30 ${EVENT.tracks[i]} track in ${r}`), `16:00 Closing keynote (${keynoteRoom})`],
          slotTimes: SLOTS.map((s) => `day ${s.day} ${s.time}`),
          slots: trackRooms.length * 10,
        })),
        placeTalks: t(
          'placeTalks',
          'WRITE: put talks into the schedule, for one or more tracks in one call. Fills the next free slots of each track in order (10 slots per track over 2 days).',
          z.object({ tracks: z.array(z.object({ track: TRACK, submissionIds: z.array(z.string()).describe('Submission IDs like S-102') })) }),
          ({ tracks }) => plan.placeTalks(w('program'), tracks),
        ),
      };
    case 'venue':
      return {
        // step-free access and hearing support are Accessibility's data: the venue catalogue does not carry them
        listRooms: t('listRooms', 'Rooms with seats and price per day. Accessibility checks step-free access.', z.object({}), () =>
          rooms.map(({ id, seats, eurPerDay, ...rest }) => ({ id, seats, eurPerDay, ...('note' in rest ? { note: rest.note } : {}) })),
        ),
        checkAvailability: t('checkAvailability', 'Availability of rooms on the event dates', z.object({ rooms: z.array(z.string()) }), ({ rooms: rs }) => rs.map((r) => ({ room: r, status: availability[r] ?? 'unknown' }))),
        assignRooms: t(
          'assignRooms',
          'WRITE: assign one or more rooms in the plan in one call: keynote room, the room of a track, and/or the keynote overflow room. Updates the venue cost line.',
          z.object({ rooms: z.array(z.object({ room: z.enum(BOOKABLE_ROOMS), track: TRACK.nullable().optional(), keynote: z.boolean().optional(), overflow: z.boolean().optional(), note: z.string().optional() })) }),
          ({ rooms: list }) => plan.assignRooms(w('venue'), list),
        ),
        dropRoom: t('dropRoom', 'WRITE: take a room out of the plan, with the reason. Updates the venue cost line.', z.object({ room: z.enum(BOOKABLE_ROOMS), reason: z.string() }), ({ room, reason }) => plan.dropRoom(w('venue'), room, reason)),
        quoteVenue: t('quoteVenue', 'Price for rooms plus AV for the event days', z.object({ rooms: z.array(z.string()) }), ({ rooms: rs }) => {
          const roomCost = rs.reduce((s, r) => s + (rooms.find((x) => x.id === r)?.eurPerDay ?? 0) * EVENT.days, 0);
          return { rooms: rs, roomsEur: roomCost, avEur: AV_PER_DAY * EVENT.days, totalEur: roomCost + AV_PER_DAY * EVENT.days };
        }),
      };
    case 'catering':
      return {
        listCaterers: t('listCaterers', 'Caterers with price per person and day', z.object({}), () => caterers),
        dietaryStats: t('dietaryStats', 'Dietary requirements from registrations', z.object({}), () => dietary),
        quoteCatering: t('quoteCatering', 'Catering price for headcount and days', z.object({ caterer: z.string(), headcount: z.number() }), ({ caterer, headcount }) => {
          const c = caterers.find((x) => x.id === caterer) ?? caterers[0];
          return { caterer: c.id, headcount, days: EVENT.days, totalEur: euro(c.eurPerPersonDay * headcount * EVENT.days), vegan: c.vegan };
        }),
        chooseCaterer: t('chooseCaterer', 'WRITE: choose the caterer for the event. Records the catering cost line.', z.object({ caterer: z.string(), headcount: z.number() }), ({ caterer, headcount }) => plan.chooseCaterer(w('catering'), caterer, headcount)),
      };
    case 'travel':
      return {
        listInternationalSpeakers: t(
          'listInternationalSpeakers',
          'Shortlisted speakers who need flights: count by country, and each speaker with ID. Optional country filter, for example US.',
          z.object({ country: z.string().optional().describe('Two-letter country code, for example US') }),
          ({ country }) => {
            const c = country?.trim().toUpperCase();
            return c ? { country: c, speakers: travellingSpeakers.filter((s) => s.origin === c) } : { byCountry: internationalSpeakers, speakers: travellingSpeakers };
          },
        ),
        quoteTravel: t('quoteTravel', 'List prices: flights and 3 hotel nights for the international speakers', z.object({ nights: z.number().default(3) }), ({ nights }) => {
          const n = internationalSpeakers.reduce((s, x) => s + x.count, 0);
          const flights = internationalSpeakers.reduce((s, x) => s + x.count * x.flightEur, 0);
          return { speakers: n, flightsEur: flights, hotelEur: n * nights * HOTEL_EUR_PER_NIGHT, totalEur: flights + n * nights * HOTEL_EUR_PER_NIGHT };
        }),
        bookTravel: t(
          'bookTravel',
          `WRITE (needs approval): propose flights and hotel for speakers in one call. ${APPROVAL_NOTE} With flightOfferIds (from quoteFlights) and hotelOfferId (from quoteHotel) it books those offers; without them, list prices.`,
          z.object({
            speakerIds: z.array(z.string()),
            nights: z.number().default(3),
            flightOfferIds: z.array(z.string()).optional(),
            hotelOfferId: z.string().optional(),
          }),
          ({ speakerIds, nights, flightOfferIds, hotelOfferId }) => plan.proposeBooking(w('travel'), 'bookTravel', { speakerIds, nights, flightOfferIds, hotelOfferId }),
        ),
        lastProposal: t('lastProposal', 'The last booking proposal of this setup and what the person decided: pending, approved, or declined with the reason. Offer IDs included, so a new proposal can reuse them.', z.object({}), () =>
          plan.lastProposal(mode),
        ),
        // ---- second request: passports and the slow outside systems ----
        readPassports: t(
          'readPassports',
          'Passport registry (fake). Nationality, passport number and expiry per speaker, plus the visa rules. Passport numbers are personal data: never repeat them in answers, notes or messages.',
          z.object({ speakerIds: z.array(z.string()) }),
          async ({ speakerIds }) => {
            await sys.systemWait('readPassports');
            return { rules: VISA_RULES, passports: passports.filter((p) => speakerIds.includes(p.speakerId)) };
          },
          sys.SYSTEMS.passports,
        ),
        recordVisaChecks: t(
          'recordVisaChecks',
          'WRITE: record the visa status of one or more speakers in the plan: visa-free, visa needed, or passport too short. The note must not contain passport numbers.',
          z.object({ checks: z.array(z.object({ speakerId: z.string(), status: z.enum(['visa-free', 'visa needed', 'passport too short']), note: z.string().optional() })) }),
          ({ checks }) => plan.recordVisaChecks(w('travel'), checks),
        ),
        quoteFlights: t(
          'quoteFlights',
          'SkyQuote (fake airline system, slow): flight offers for all given speakers in one call. Two offers per speaker with offer IDs. Book only offers that arrive by 10 May.',
          z.object({ speakerIds: z.array(z.string()) }),
          ({ speakerIds }) => sys.quoteFlights(mode, speakerIds),
          sys.SYSTEMS.airline,
        ),
        bookFlights: t(
          'bookFlights',
          `WRITE (needs approval): propose booking flight offers (offer IDs from quoteFlights) in SkyQuote. ${APPROVAL_NOTE}`,
          z.object({ offerIds: z.array(z.string()) }),
          ({ offerIds }) => {
            const ids = [...new Set(offerIds.map((o) => sys.quotedOffer(mode, o)?.speakerId).filter((x): x is string => !!x))];
            return plan.proposeBooking(w('travel'), 'bookFlights', { speakerIds: ids, flightOfferIds: offerIds, hotel: false });
          },
          sys.SYSTEMS.airline,
        ),
        quoteHotel: t(
          'quoteHotel',
          'RheinRooms (fake hotel system, slow): hotel offers for all given speakers in one call, check-in on the arrival day 10 May.',
          z.object({ speakerIds: z.array(z.string()), nights: z.number().default(3) }),
          ({ speakerIds, nights }) => sys.quoteHotel(mode, speakerIds, nights),
          sys.SYSTEMS.hotel,
        ),
        bookHotel: t(
          'bookHotel',
          `WRITE (needs approval): propose booking one hotel offer (offer ID from quoteHotel) for speakers in RheinRooms. ${APPROVAL_NOTE}`,
          z.object({ offerId: z.string(), speakerIds: z.array(z.string()), nights: z.number().default(3) }),
          ({ offerId, speakerIds, nights }) => plan.proposeBooking(w('travel'), 'bookHotel', { speakerIds, nights, hotelOfferId: offerId, flights: false }),
          sys.SYSTEMS.hotel,
        ),
      };
    case 'budget':
      return {
        getBudget: t('getBudget', 'Budget and committed spend', z.object({}), () => ({ ...ledger, freeEur: ledger.budgetEur - ledger.committed.reduce((s, c) => s + c.eur, 0) })),
        checkPlan: t('checkPlan', 'Check a list of planned costs against the budget', z.object({ items: z.array(z.object({ item: z.string(), eur: z.number() })) }), ({ items }) => {
          const all = [...ledger.committed, ...items];
          const total = all.reduce((s, i) => s + i.eur, 0);
          return { totalEur: total, budgetEur: ledger.budgetEur, bufferEur: ledger.budgetEur - total, bufferPct: Math.round(((ledger.budgetEur - total) / ledger.budgetEur) * 1000) / 10, ok: total <= ledger.budgetEur };
        }),
        recordBudgetCheck: t(
          'recordBudgetCheck',
          'WRITE: record the budget check in the plan, with the cost per domain you checked (committed marketing spend is added automatically). Mark values you did not get from the owner as estimate.',
          z.object({ lines: z.array(z.object({ domain: z.enum(['venue', 'catering', 'travel', 'access']).describe('access = live captions'), eur: z.number(), estimate: z.boolean().optional() })) }),
          ({ lines }) => plan.recordBudgetCheck(w('budget'), lines),
        ),
      };
    case 'marketing':
      return {
        ticketForecast: t('ticketForecast', 'Tickets sold and forecast', z.object({}), () => tickets),
        sponsorPipeline: t('sponsorPipeline', 'Signed and negotiating sponsors', z.object({}), () => sponsors),
      };
    case 'access':
      return {
        checkRoomAccess: t('checkRoomAccess', 'Step-free access and hearing support per room', z.object({ rooms: z.array(z.string()) }), ({ rooms: rs }) =>
          rs.map((r) => {
            const x = rooms.find((y) => y.id === r);
            return { room: r, stepFree: x?.stepFree ?? null, inductionLoop: x?.inductionLoop ?? null };
          }),
        ),
        quoteCaptioning: t('quoteCaptioning', 'Live captioning price for rooms and days', z.object({ rooms: z.array(z.string()) }), ({ rooms: rs }) => ({ rooms: rs, totalEur: rs.length * EVENT.days * captioning.eurPerRoomDay, note: captioning.note })),
        markRooms: t(
          'markRooms',
          'WRITE: record the accessibility finding for one or more rooms in one call (step-free or not, with a short note). Works for Hall A, Room B, Room C, Room D and the Foyer.',
          z.object({ rooms: z.array(z.object({ room: z.enum(ROOM_IDS), stepFree: z.boolean(), note: z.string() })) }),
          ({ rooms: list }) => plan.markRooms(w('access'), list),
        ),
        bookCaptions: t('bookCaptions', 'WRITE: book live captions for rooms. Records the captions cost line.', z.object({ rooms: z.array(z.enum(BOOKABLE_ROOMS)) }), ({ rooms: rs }) => plan.bookCaptions(w('access'), rs)),
      };
  }
}

export function allDomainTools(owner: string) {
  // one flagRisk for the single agent: it says which domain the risk belongs to
  const flagRisk = vizTool(owner, 'flagRisk', flagRiskDescription, z.object({ domain: z.enum(DOMAINS as [Domain, ...Domain[]]), text: z.string(), key: z.string().optional() }), ({ domain, text, key }: { domain: Domain; text: string; key?: string }) =>
    plan.flagRisk(writer(owner, domain), text, key),
  );
  return Object.assign({}, ...DOMAINS.map((d) => ownTools(d, owner)), { flagRisk });
}

/** The write tools each domain owns (flagRisk is bound to the owner's domain). */
export const WRITE_TOOLS: Record<Domain, string[]> = {
  program: ['placeTalks', 'flagRisk'],
  venue: ['assignRooms', 'dropRoom', 'flagRisk'],
  catering: ['chooseCaterer', 'flagRisk'],
  travel: ['bookTravel', 'recordVisaChecks', 'bookFlights', 'bookHotel', 'flagRisk'],
  budget: ['recordBudgetCheck', 'flagRisk'],
  marketing: ['flagRisk'],
  access: ['markRooms', 'bookCaptions', 'flagRisk'],
};
