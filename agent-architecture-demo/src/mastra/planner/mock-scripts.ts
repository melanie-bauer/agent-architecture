// Scripted behaviour for the planner in DEMO_MODE=mock (or PLANNER_MODE=mock).
// The scripts only decide WHICH tool or peer an agent calls next. All numbers in the answers come from the tools,
// and everything the plan screens show is written by the write tools (plan-store.ts), attributed to the calling agent.
// Mock mode shows the topology (who talks to whom, which tools run where, who writes what), not model quality.
// Four requests: the stage requests "rooms" and "travelUs" (picked by the request the setup works on, see STAGE below),
// and the big "Plan the conference" and "Book speaker travel" (the travel request mentions passports).
// Bookings only create a pending approval; after a decline the next proposal has 2 hotel nights instead of 3.
import type { MockAction, MockCtx, MockScript } from '../model/mock-model';
import { shortlist, TALKS_PER_TRACK, travellingSpeakers } from './data';
import { currentRequest } from './plan-store';
import { modeOf } from './viz';

type Step = MockAction | ((ctx: MockCtx) => MockAction);
type Call = { tool: string; args: Record<string, unknown> };
const lastOut = (ctx: MockCtx, tool: string) => ctx.turnToolResults.filter((r) => r.toolName === tool).at(-1)?.output ?? '';
const out = (ctx: MockCtx, tool: string) => ctx.turnToolResults.filter((r) => r.toolName === tool).map((r) => r.output).join('\n');
const num = (s: string, key: string) => Number(s.match(new RegExp(`\\\\?"${key}\\\\?":(\\d+)`))?.[1] ?? NaN);
const eur = (n: number) => (Number.isFinite(n) ? `€${n.toLocaleString('en-US')}` : '€?');

/** A tool result as an object (the recorded output can be JSON inside JSON, or wrapped as {type:'json', value}). */
function parsed(s: string): any {
  let v: any = s;
  for (let i = 0; i < 4 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' && 'value' in v && v.type === 'json' ? v.value : v;
}

/** Run a fixed sequence of steps (one step = one model call, possibly with parallel tool calls); then the final text. */
function seq(steps: Step[], final: (ctx: MockCtx) => string): MockScript {
  return (ctx) => {
    let consumed = 0;
    for (const s of steps) {
      const a = typeof s === 'function' ? s(ctx) : s;
      const size = 'parallel' in a ? a.parallel.length : 1;
      if (consumed + size > ctx.turnToolResults.length) return a;
      consumed += size;
    }
    return { text: final(ctx) };
  };
}
const firstEur = (s: string, after = '') => {
  const i = after ? s.indexOf(after) : 0;
  const m = s.slice(Math.max(0, i)).match(/€([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : NaN;
};
const par = (...calls: Call[]): MockAction => ({ parallel: calls });
// "passport and visa": the hub's own instructions mention passports, and over A2A they can reach the specialist with the prompt
const isTravelRequest = (text: string) => /passports? and visas?/i.test(text);

const ALL_ROOMS = ['Hall A', 'Room B', 'Room C', 'Room D'];
const PLAN_ROOMS = ['Hall A', 'Room B', 'Room D'];

// ---------- the conference writes, shared by all three modes ----------
const PLACE: Call = { tool: 'placeTalks', args: { tracks: shortlist(TALKS_PER_TRACK).map((t) => ({ track: t.track, submissionIds: t.talks.map((s) => s.id) })) } };
const ASSIGN_FINAL: Call = {
  tool: 'assignRooms',
  args: {
    rooms: [
      { room: 'Hall A', keynote: true, track: 'Agents' },
      { room: 'Room B', track: 'AI Engineering', overflow: true, note: 'Keynote overflow: live stream from Hall A' },
      { room: 'Room D', track: 'AI in Practice' },
    ],
  },
};
// the first venue proposal in centralized mode, before accessibility's finding reaches the venue manager
const ASSIGN_FIRST: Call = {
  tool: 'assignRooms',
  args: {
    rooms: [
      { room: 'Hall A', keynote: true },
      { room: 'Room B', track: 'AI Engineering', overflow: true, note: 'Keynote overflow: live stream from Hall A' },
      { room: 'Room C', track: 'Agents' },
      { room: 'Room D', track: 'AI in Practice' },
    ],
  },
};
const MARKS: Call = {
  tool: 'markRooms',
  args: {
    rooms: [
      { room: 'Hall A', stepFree: true, note: 'Step-free, induction loop.' },
      { room: 'Room B', stepFree: true, note: 'Step-free.' },
      { room: 'Room C', stepFree: false, note: 'Stairs only. Do not use.' },
      { room: 'Room D', stepFree: true, note: 'Step-free.' },
      { room: 'Foyer', stepFree: true, note: 'Step-free. Catering and expo.' },
    ],
  },
};
const CAPTIONS: Call = { tool: 'bookCaptions', args: { rooms: ['Hall A'] } };
const CATER: Call = { tool: 'chooseCaterer', args: { caterer: 'Rheinküche', headcount: 600 } };
const TRAVEL: Call = { tool: 'bookTravel', args: { speakerIds: travellingSpeakers.map((s) => s.id), nights: 3 } };
const RISK = {
  overflow: { text: 'Keynote has 600 attendees and Hall A seats 450. Overflow stream to Room B.', key: 'keynote-overflow' },
  tickets: { text: 'Ticket forecast 590 of 600: close to the cap.', key: 'tickets' },
  aiforge: { text: 'AIForge Gold sponsorship is still in negotiation.', key: 'aiforge' },
};
const risk = (r: { text: string; key: string }, domain?: string): Call => ({ tool: 'flagRisk', args: domain ? { domain, ...r } : r });

type Numbers = { venue: number; catering: number; travel: number; captions: number; total: number; buffer: number };
const finalPlan = (n: Numbers, extra = '') =>
  `The draft plan is recorded: 30 talks, Hall A, Room B and Room D, Rheinküche, travel for 14 speakers waits for your approval. Total ${eur(n.total)} of €180,000, buffer ${eur(n.buffer)}. Room C is out because it is not step-free. See Overview and Budget for the details.${extra}`;

/** The budget lines the triage hub sends to the budget specialist, read back from its message ("venue €38,600, ..."). */
const eurAfter = (text: string, key: string) => {
  const all = [...text.matchAll(new RegExp(`${key}\\W{0,3}€\\s?([0-9,]+)`, 'gi'))];
  return all.length ? Number(all.at(-1)![1].replace(/,/g, '')) : NaN;
};
const linesFrom = (text: string) => ({
  venue: eurAfter(text, 'venue'),
  catering: eurAfter(text, 'catering'),
  travel: eurAfter(text, 'travel'),
  access: eurAfter(text, 'captions'),
});

// ---------- the travel writes (second request), derived from the tool results ----------
const SPEAKERS = travellingSpeakers.map((s) => s.id);
const READ_PASSPORTS: Call = { tool: 'readPassports', args: { speakerIds: SPEAKERS } };
const QUOTE_FLIGHTS: Call = { tool: 'quoteFlights', args: { speakerIds: SPEAKERS } };
const QUOTE_HOTEL: Call = { tool: 'quoteHotel', args: { speakerIds: SPEAKERS, nights: 3 } };
const LAST_DAY = '2027-08-13';
/** Visa status from the passport registry's answer: nationality and expiry, never the number. */
const visaChecks = (c: MockCtx): Call => {
  const p = parsed(lastOut(c, 'readPassports'))?.passports ?? [];
  return {
    tool: 'recordVisaChecks',
    args: {
      checks: p.map((x: any) =>
        x.expires < LAST_DAY
          ? { speakerId: x.speakerId, status: 'passport too short', note: `Passport expires ${x.expires}, it must be valid until ${LAST_DAY}. Renew before travel.` }
          : x.nationality === 'IN'
            ? { speakerId: x.speakerId, status: 'visa needed', note: 'Schengen visa needed. Invitation letter sent.' }
            : { speakerId: x.speakerId, status: 'visa-free', note: '' },
      ),
    },
  };
};
const visaRisks = (c: MockCtx, withDomain = false): Call[] => {
  const p = parsed(lastOut(c, 'readPassports'))?.passports ?? [];
  const calls: Call[] = [];
  for (const x of p) {
    if (x.expires < LAST_DAY) calls.push(risk({ text: `${x.name} has a passport that expires ${x.expires}. It must be renewed before travel.`, key: 'passport-renewal' }, withDomain ? 'travel' : undefined));
    else if (x.nationality === 'IN') calls.push(risk({ text: `${x.name} needs a Schengen visa. The invitation letter is sent, the visa is still open.`, key: 'schengen-visa' }, withDomain ? 'travel' : undefined));
  }
  return calls;
};
/** One proposal for flights and hotel: the offers that arrive by 10 May and the cheaper hotel. Nothing is booked until a person approves. */
const propose = (c: MockCtx, speakerIds: string[], nights: number): Call => {
  const offers: any[] = parsed(lastOut(c, 'quoteFlights'))?.offers ?? [];
  const hotels: any[] = parsed(lastOut(c, 'quoteHotel'))?.offers ?? [];
  const cheapest = [...hotels].sort((a, b) => a.eurPerNight - b.eurPerNight)[0];
  return { tool: 'bookTravel', args: { speakerIds, nights, flightOfferIds: offers.filter((o) => o.arrives.startsWith('2027-05-10')).map((o) => o.offerId), hotelOfferId: cheapest?.offerId ?? 'RR-AMRHEIN' } };
};
const travelEur = (c: MockCtx) => num(lastOut(c, 'bookTravel'), 'totalEur');
const travelAnswer = (c: MockCtx) =>
  `Proposed for 14 speakers: flights that arrive on 10 May and 3 hotel nights, travel cost ${eur(travelEur(c))}. It waits for a person's approval. One speaker needs a visa and one must renew a passport. Passport numbers stay with Travel.`;

// ---------- the stage requests: rooms (venue, access, budget) and travelUs (travel, budget) ----------
const ROOMS_FIRST: Call = {
  tool: 'assignRooms',
  args: {
    rooms: [
      { room: 'Hall A', keynote: true },
      { room: 'Room B', track: 'AI Engineering' },
      { room: 'Room C', track: 'Agents' },
      { room: 'Room D', track: 'AI in Practice' },
    ],
  },
};
const ROOMS_FINAL: Call = {
  tool: 'assignRooms',
  args: { rooms: [{ room: 'Hall A', keynote: true, track: 'Agents' }, { room: 'Room B', track: 'AI Engineering' }, { room: 'Room D', track: 'AI in Practice' }] },
};
const ROOMS_MARKS: Call = { tool: 'markRooms', args: { rooms: (MARKS.args.rooms as { room: string }[]).filter((r) => r.room !== 'Foyer') } };
const CHECK_ROOMS: Call = { tool: 'checkRoomAccess', args: { rooms: ALL_ROOMS } };
const DROP_C: Call[] = [
  { tool: 'dropRoom', args: { room: 'Room C', reason: 'Stairs only, not step-free (accessibility)' } },
  { tool: 'assignRooms', args: { rooms: [{ room: 'Hall A', keynote: true, track: 'Agents' }] } },
];
const venueEur = (c: MockCtx) => num(lastOut(c, 'assignRooms'), 'venueEur');
const budgetLine = (c: MockCtx, domain: string, value: number): Call => ({ tool: 'recordBudgetCheck', args: { lines: [{ domain, eur: value }] } });
const checkedText = (c: MockCtx) => `Total ${eur(num(lastOut(c, 'recordBudgetCheck'), 'totalEur'))} of €180,000 with the committed marketing spend, buffer ${eur(num(lastOut(c, 'recordBudgetCheck'), 'bufferEur'))}.`;
const ROOMS_DONE = 'Hall A holds the keynotes and the Agents track, Room B has AI Engineering and Room D AI in Practice. Room C is out because it is not step-free.';

const US = travellingSpeakers.filter((s) => s.origin === 'US').map((s) => s.id);
// the reason follows a colon; the hub's own instructions (which can reach a specialist over A2A) mention declines without one
const declined = (c: MockCtx) => /declined:/i.test(c.lastUserText);
const reasonOf = (text: string) => text.match(/declined:\s*(.*?)\.\s*Propose/i)?.[1] ?? 'see the reason on the card';
const US_STEPS: Step[] = [
  { tool: 'listInternationalSpeakers', args: { country: 'US' } },
  par({ tool: 'readPassports', args: { speakerIds: US } }, { tool: 'quoteFlights', args: { speakerIds: US } }, { tool: 'quoteHotel', args: { speakerIds: US, nights: 3 } }),
  (c) => par(visaChecks(c), propose(c, US, 3)),
];
/** After a decline: read the last proposal (with the reason) from the plan, propose again with 2 nights. */
const US_AGAIN: Step[] = [
  { tool: 'lastProposal', args: {} },
  (c) => {
    const last = parsed(lastOut(c, 'lastProposal')) ?? {};
    return { tool: 'bookTravel', args: { speakerIds: last.speakerIds ?? US, nights: 2, flightOfferIds: last.flightOfferIds ?? [], hotelOfferId: last.hotelOfferId ?? 'RR-AMRHEIN' } };
  },
];
const proposal = (c: MockCtx) => parsed(lastOut(c, 'bookTravel')) ?? {};
const proposalText = (c: MockCtx) => {
  const r = proposal(c);
  return `Proposed for the ${r.speakers ?? 4} US speakers: flights ${eur(r.flightsEur)}, hotel ${r.hotelNights} nights ${eur(r.hotelEur)}, total ${eur(r.totalEur)}. It waits for a person's approval.`;
};
const askBudgetTravel = (c: MockCtx): Call[] => [
  { tool: 'postToBoard', args: { section: 'travel', note: `Booking for the 4 US speakers proposed: total ${eur(proposal(c).totalEur)}, waiting for approval.` } },
  { tool: 'askPeer', args: { peer: 'budget', request: `Travel proposal for the four US speakers: travel ${eur(proposal(c).totalEur)}, waiting for approval. Please check it against the budget and record the check.` } },
];

const STAGE: Record<string, Partial<Record<'rooms' | 'travelUs', MockScript>>> = {
  'planner-single': {
    rooms: seq([par({ tool: 'listRooms', args: {} }, CHECK_ROOMS), par(ROOMS_FINAL, ROOMS_MARKS), (c) => budgetLine(c, 'venue', venueEur(c))], (c) => `${ROOMS_DONE} Venue cost ${eur(venueEur(c))}. ${checkedText(c)} See Rooms and Budget.`),
    travelUs: (ctx) =>
      seq(declined(ctx) ? [...US_AGAIN, (c) => budgetLine(c, 'travel', proposal(c).totalEur)] : [...US_STEPS, (c) => budgetLine(c, 'travel', proposal(c).totalEur)], (c) => `${proposalText(c)} Budget check recorded. ${checkedText(c)}`)(ctx),
  },
  'planner-triage': {
    rooms: seq(
      [
        par(
          { tool: 'agent-venue', args: { prompt: 'Assign Hall A to the keynotes and one room per track for 11 and 12 May. Record it in the plan and give me the venue cost.' } },
          { tool: 'agent-access', args: { prompt: 'Check step-free access for Hall A, Room B, Room C and Room D and record it in the plan.' } },
        ),
        // the hub has to relay what one specialist found to another one
        { tool: 'agent-venue', args: { prompt: 'Accessibility says Room C has no step-free access. Drop Room C, give its track another room, and tell me the new cost.' } },
        (c) => ({ tool: 'agent-budget', args: { prompt: `Check the venue cost against the budget and record the check: venue ${eur(firstEur(lastOut(c, 'agent-venue')))}.` } }),
      ],
      (c) => `${ROOMS_DONE} Venue cost ${eur(firstEur(lastOut(c, 'agent-venue')))}. Budget: ${out(c, 'agent-budget').replace(/^"|"$/g, '')} See Rooms and Budget.`,
    ),
    travelUs: (ctx) =>
      seq(
        [
          {
            tool: 'agent-travel',
            args: {
              prompt: declined(ctx)
                ? `The booking was declined: ${reasonOf(ctx.lastUserText)}. Propose a new booking for the four US speakers that follows the reason, and tell me the total.`
                : 'Propose flights and hotels for the four speakers from the US (3 hotel nights) and record their visa checks. Tell me the total.',
            },
          },
          (c) => ({ tool: 'agent-budget', args: { prompt: `Check the proposed travel total against the budget and record the check: travel ${eur(firstEur(out(c, 'agent-travel'), 'total'))}.` } }),
        ],
        (c) => `Travel proposed the booking for the four US speakers: total ${eur(firstEur(out(c, 'agent-travel'), 'total'))}. It waits for your approval on the card. Budget recorded the check. Passport data stayed with Travel.`,
      )(ctx),
  },
  'spec-venue': {
    rooms: (ctx) =>
      /room c/i.test(ctx.lastUserText)
        ? seq([par(...DROP_C)], (c) => `Without Room C: Hall A holds the keynotes and Agents, Room B and Room D the other tracks. Venue ${eur(venueEur(c))} incl. AV.`)(ctx)
        : seq([{ tool: 'listRooms', args: {} }, ROOMS_FIRST], (c) => `Hall A for the keynotes, Agents in Room C, AI Engineering in Room B, AI in Practice in Room D. Venue ${eur(venueEur(c))} incl. AV for 2 days.`)(ctx),
  },
  'spec-access': {
    rooms: seq([CHECK_ROOMS, ROOMS_MARKS], () => 'Room C is stairs only, not step-free. Hall A, Room B and Room D are step-free.'),
  },
  'spec-travel': {
    travelUs: (ctx) => seq(declined(ctx) ? US_AGAIN : US_STEPS, proposalText)(ctx),
  },
  'peer-venue': {
    rooms: (ctx) =>
      /^\[from /.test(ctx.lastUserText)
        ? seq([{ tool: 'listRooms', args: {} }], () => 'Hall A, Room B, Room C and Room D are free on both days.')(ctx)
        : seq(
            [
              par({ tool: 'listRooms', args: {} }, { tool: 'quoteVenue', args: { rooms: ALL_ROOMS } }),
              (c) => par(ROOMS_FIRST, { tool: 'postToBoard', args: { section: 'venue', note: `Hall A keynotes, Agents in Room C, AI Engineering in Room B, AI in Practice in Room D. Venue ${eur(num(out(c, 'quoteVenue'), 'totalEur'))} incl. AV.` } }),
              // access and budget at the same time: budget checks before the access finding is applied
              (c) =>
                par(
                  { tool: 'askPeer', args: { peer: 'access', request: 'Are Hall A, Room B, Room C and Room D step-free?' } },
                  { tool: 'askPeer', args: { peer: 'budget', request: `My room plan is on the board: venue ${eur(venueEur(c))}. Please check it against the budget and record the check.` } },
                ),
              par(...DROP_C),
              (c) => ({ tool: 'postToBoard', args: { section: 'venue', note: `Room C dropped (stairs). Agents moved to Hall A. Venue ${eur(venueEur(c))} incl. AV.` } }),
            ],
            (c) => `${ROOMS_DONE} Venue cost ${eur(venueEur(c))}. Budget answered before Room C was dropped.`,
          )(ctx),
  },
  'peer-access': {
    rooms: seq([CHECK_ROOMS, par(ROOMS_MARKS, { tool: 'postToBoard', args: { section: 'access', note: 'Room C stairs only, do not use. Hall A, Room B, Room D step-free.' } })], () => 'Room C is not step-free, do not use it. Hall A, Room B and Room D are step-free.'),
  },
  'peer-budget': {
    // reads the venue cost from the board as it is now: Room C is still in it
    rooms: seq(
      [{ tool: 'readBoard', args: {} }, (c) => par(budgetLine(c, 'venue', firstEur(out(c, 'readBoard'), 'venue')), { tool: 'postToBoard', args: { section: 'budget', note: `Venue ${eur(firstEur(out(c, 'readBoard'), 'venue'))} checked.` } })],
      (c) => `Venue ${eur(firstEur(out(c, 'readBoard'), 'venue'))} fits. ${checkedText(c)}`,
    ),
    travelUs: seq([(c) => budgetLine(c, 'travel', firstEur(c.lastUserText))], (c) => `Travel ${eur(firstEur(c.lastUserText))} fits. ${checkedText(c)}`),
  },
  'peer-travel': {
    travelUs: (ctx) =>
      /^\[from /.test(ctx.lastUserText)
        ? seq([{ tool: 'lastProposal', args: {} }], (c) => `Last proposal: ${eur(num(lastOut(c, 'lastProposal'), 'totalEur'))}.`)(ctx)
        : seq([...(declined(ctx) ? US_AGAIN : US_STEPS), (c) => par(...askBudgetTravel(c))], (c) => `${proposalText(c)} Budget recorded the check.`)(ctx),
  },
};


const bigRequests: Record<string, MockScript> = {
  // ---------------- (a) single agent: one node, every tool ----------------
  'planner-single': (ctx) =>
    isTravelRequest(ctx.lastUserText)
      ? seq(
          [
            par({ tool: 'listInternationalSpeakers', args: {} }, { tool: 'shortlistTalks', args: { slotsPerTrack: 10 } }),
            par(READ_PASSPORTS, QUOTE_FLIGHTS, QUOTE_HOTEL, PLACE),
            (c) => par(visaChecks(c), propose(c, SPEAKERS, 3), ...visaRisks(c, true)),
            (c) => ({ tool: 'recordBudgetCheck', args: { lines: [{ domain: 'travel', eur: travelEur(c) }] } }),
          ],
          (c) => `${travelAnswer(c)} Budget check recorded.`,
        )(ctx)
      : seq(
          [
            { tool: 'listSubmissions', args: {} },
            { tool: 'shortlistTalks', args: { slotsPerTrack: 10 } },
            { tool: 'listRooms', args: {} },
            { tool: 'checkAvailability', args: { rooms: ALL_ROOMS } },
            { tool: 'checkRoomAccess', args: { rooms: [...ALL_ROOMS, 'Foyer'] } },
            { tool: 'quoteVenue', args: { rooms: PLAN_ROOMS } },
            par(PLACE, ASSIGN_FINAL, MARKS, CAPTIONS),
            par({ tool: 'dietaryStats', args: {} }, { tool: 'listCaterers', args: {} }, { tool: 'listInternationalSpeakers', args: {} }),
            par({ tool: 'quoteCatering', args: { caterer: 'Rheinküche', headcount: 600 } }, { tool: 'quoteTravel', args: { nights: 3 } }, { tool: 'quoteCaptioning', args: { rooms: ['Hall A'] } }),
            par(CATER, TRAVEL, { tool: 'ticketForecast', args: {} }, { tool: 'sponsorPipeline', args: {} }, { tool: 'getBudget', args: {} }),
            (c) => ({
              tool: 'checkPlan',
              args: {
                items: [
                  { item: 'Venue (Hall A, Room B, Room D + AV)', eur: num(out(c, 'quoteVenue'), 'totalEur') },
                  { item: 'Catering Rheinküche 600 x 2 days', eur: num(out(c, 'quoteCatering'), 'totalEur') },
                  { item: 'Speaker travel', eur: num(out(c, 'quoteTravel'), 'totalEur') },
                  { item: 'Live captions Hall A', eur: num(out(c, 'quoteCaptioning'), 'totalEur') },
                ],
              },
            }),
            (c) =>
              par(
                {
                  tool: 'recordBudgetCheck',
                  args: {
                    lines: [
                      { domain: 'venue', eur: num(out(c, 'quoteVenue'), 'totalEur') },
                      { domain: 'catering', eur: num(out(c, 'quoteCatering'), 'totalEur') },
                      { domain: 'travel', eur: num(out(c, 'quoteTravel'), 'totalEur') },
                      { domain: 'access', eur: num(out(c, 'quoteCaptioning'), 'totalEur') },
                    ],
                  },
                },
                risk(RISK.overflow, 'venue'),
                risk(RISK.tickets, 'marketing'),
                risk(RISK.aiforge, 'marketing'),
              ),
          ],
          (c) =>
            finalPlan({
              venue: num(out(c, 'quoteVenue'), 'totalEur'),
              catering: num(out(c, 'quoteCatering'), 'totalEur'),
              travel: num(out(c, 'quoteTravel'), 'totalEur'),
              captions: num(out(c, 'quoteCaptioning'), 'totalEur'),
              total: num(out(c, 'checkPlan'), 'totalEur'),
              buffer: num(out(c, 'checkPlan'), 'bufferEur'),
            }),
        )(ctx),

  // ---------------- (b) centralized: triage delegates, specialists never talk to each other ----------------
  'planner-triage': (ctx) =>
    isTravelRequest(ctx.lastUserText)
      ? seq(
          [
            par(
              { tool: 'agent-travel', args: { prompt: 'Book travel for the 14 international speakers: check passports and visas, quote and book flights that arrive by 10 May, then quote and book the hotel. Record everything and tell me the travel cost.' } },
              { tool: 'agent-program', args: { prompt: 'Put all 30 talks into the schedule, 10 per track, and record them.' } },
            ),
            (c) => ({ tool: 'agent-budget', args: { prompt: `Check the travel cost against the budget and record the check: travel ${eur(firstEur(out(c, 'agent-travel'), 'cost'))}.` } }),
          ],
          (c) => `Travel proposed the booking for 14 speakers, ${eur(firstEur(out(c, 'agent-travel'), 'cost'))}, and Program scheduled 30 talks at the same time. The booking waits for your approval. Budget recorded the check. One visa and one passport renewal are open.`,
        )(ctx)
      : seq(
          [
            // independent questions go out in parallel
            par(
              { tool: 'agent-program', args: { prompt: 'Shortlist talks for 3 tracks, 10 slots each, and put them into the schedule. How many international speakers?' } },
              { tool: 'agent-venue', args: { prompt: 'We need a keynote room for 600 people and 3 track rooms (at least 150 seats) on 11 and 12 May. Assign them in the plan and give me the cost.' } },
              { tool: 'agent-access', args: { prompt: 'Check step-free access and hearing support for Hall A, Room B, Room C, Room D and the Foyer. Book captions for the keynote hall.' } },
              { tool: 'agent-catering', args: { prompt: 'Catering for 600 people, 2 days. 12 % vegan. Choose a caterer.' } },
              { tool: 'agent-travel', args: { prompt: 'Book travel for the 14 international speakers (3 hotel nights). Total cost?' } },
              { tool: 'agent-marketing', args: { prompt: 'Ticket forecast and signed sponsor money? Flag the risks.' } },
            ),
            // the hub has to relay what one specialist found to another one
            { tool: 'agent-venue', args: { prompt: 'Accessibility says Room C has no step-free access. Drop Room C, give its track another room, and tell me the new cost.' } },
            (c) => ({
              tool: 'agent-budget',
              args: {
                prompt: `Check against the budget and record the check: venue ${eur(firstEur(lastOut(c, 'agent-venue')))}, catering ${eur(firstEur(out(c, 'agent-catering')))}, travel ${eur(firstEur(out(c, 'agent-travel')))}, captions ${eur(firstEur(out(c, 'agent-access'), 'captions'))}.`,
              },
            }),
          ],
          (c) => {
            const b = out(c, 'agent-budget');
            return finalPlan({
              venue: firstEur(lastOut(c, 'agent-venue')),
              catering: firstEur(out(c, 'agent-catering')),
              travel: firstEur(out(c, 'agent-travel')),
              captions: firstEur(out(c, 'agent-access'), 'captions'),
              total: firstEur(b, 'Total'),
              buffer: firstEur(b, 'buffer'),
            });
          },
        )(ctx),
  'spec-program': seq([{ tool: 'shortlistTalks', args: { slotsPerTrack: 10 } }, PLACE], () => '30 talks scheduled, 10 per track, from 46 submissions. 14 international speakers among them.'),
  'spec-venue': (ctx) =>
    /room c/i.test(ctx.lastUserText) && /step-free|stairs|drop|without/i.test(ctx.lastUserText)
      ? seq(
          [
            par({ tool: 'dropRoom', args: { room: 'Room C', reason: 'Stairs only, not step-free (accessibility)' } }, { tool: 'assignRooms', args: { rooms: [{ room: 'Hall A', keynote: true, track: 'Agents' }] } }, { tool: 'quoteVenue', args: { rooms: PLAN_ROOMS } }),
          ],
          (c) => `Without Room C: Hall A (keynote and Agents track), Room B, Room D. ${eur(num(out(c, 'quoteVenue'), 'totalEur'))} incl. AV.`,
        )(ctx)
      : seq(
          [par({ tool: 'listRooms', args: {} }, { tool: 'checkAvailability', args: { rooms: ALL_ROOMS } }, { tool: 'quoteVenue', args: { rooms: ALL_ROOMS } }), par(ASSIGN_FIRST, risk(RISK.overflow))],
          (c) => `Hall A (450 seats) for the keynote. 600 attendees need an overflow to Room B. Tracks in Room B, C, D. ${eur(num(out(c, 'quoteVenue'), 'totalEur'))} incl. AV, all free on both days.`,
        )(ctx),
  'spec-access': seq(
    [par({ tool: 'checkRoomAccess', args: { rooms: [...ALL_ROOMS, 'Foyer'] } }, { tool: 'quoteCaptioning', args: { rooms: ['Hall A'] } }), par(MARKS, CAPTIONS)],
    (c) => `Room C is stairs only, not step-free. Hall A has an induction loop. Live captions in Hall A: ${eur(num(out(c, 'quoteCaptioning'), 'totalEur'))}.`,
  ),
  'spec-catering': seq(
    [par({ tool: 'dietaryStats', args: {} }, { tool: 'listCaterers', args: {} }), { tool: 'quoteCatering', args: { caterer: 'Rheinküche', headcount: 600 } }, CATER],
    (c) => `Rheinküche (Mainzer Tafel has no vegan menu, 12 % need it): ${eur(num(out(c, 'quoteCatering'), 'totalEur'))} for 600 people on 2 days.`,
  ),
  'spec-travel': (ctx) =>
    isTravelRequest(ctx.lastUserText)
      ? seq([par(READ_PASSPORTS, QUOTE_FLIGHTS, QUOTE_HOTEL), (c) => par(visaChecks(c), propose(c, SPEAKERS, 3), ...visaRisks(c))], travelAnswer)(ctx)
      : seq([par({ tool: 'listInternationalSpeakers', args: {} }, { tool: 'quoteTravel', args: { nights: 3 } }), TRAVEL], (c) => `14 speakers proposed: ${eur(num(out(c, 'quoteTravel'), 'totalEur'))} (flights and 3 hotel nights), waiting for approval.`)(ctx),
  'spec-marketing': seq(
    [par({ tool: 'ticketForecast', args: {} }, { tool: 'sponsorPipeline', args: {} }), par(risk(RISK.tickets), risk(RISK.aiforge))],
    () => '412 tickets sold, forecast 590 of 600. Sponsors signed €35,000, pipeline €60,000.',
  ),
  'spec-budget': (ctx) => {
    const l = linesFrom(ctx.lastUserText);
    const lines = (Object.entries(l) as [string, number][]).filter(([, v]) => Number.isFinite(v)).map(([domain, eurValue]) => ({ domain, eur: eurValue }));
    return seq(
      [{ tool: 'recordBudgetCheck', args: { lines } }],
      (c) => `Total ${eur(num(out(c, 'recordBudgetCheck'), 'totalEur'))} of €180,000 incl. committed marketing, buffer ${eur(num(out(c, 'recordBudgetCheck'), 'bufferEur'))}.`,
    )(ctx);
  },

  // ---------------- (c) peer to peer with a shared board: peers decide themselves whom to ask ----------------
  'peer-program': (ctx) =>
    /^\[from /.test(ctx.lastUserText)
      ? seq([{ tool: 'shortlistTalks', args: { slotsPerTrack: 10 } }], () => '30 talks, 10 per track. 14 international speakers.')(ctx)
      : isTravelRequest(ctx.lastUserText)
        ? seq(
            [
              { tool: 'shortlistTalks', args: { slotsPerTrack: 10 } },
              // travel works while program writes the schedule: two things at the same time
              par({ tool: 'askPeer', args: { peer: 'travel', request: 'Please book travel for the 14 international speakers: passports and visas, flights that arrive by 10 May, hotel. What does travel cost?' } }, PLACE),
              (c) => ({ tool: 'askPeer', args: { peer: 'budget', request: `Travel is booked for ${eur(firstEur(out(c, 'askPeer'), 'cost'))}. Please check it against the budget and record the check.` } }),
            ],
            (c) => `Travel proposed the booking for 14 speakers, ${eur(firstEur(out(c, 'askPeer'), 'cost'))}, while I scheduled 30 talks. It waits for your approval. Budget recorded the check. One visa and one passport renewal are open.`,
          )(ctx)
        : seq(
            [
              { tool: 'listSubmissions', args: {} },
              { tool: 'shortlistTalks', args: { slotsPerTrack: 10 } },
              { tool: 'askPeer', args: { peer: 'venue', request: 'I need a keynote room for 600 and 3 track rooms (at least 150 seats) on both days. Please assign them in the plan.' } },
              { tool: 'askPeer', args: { peer: 'catering', request: 'Catering for 600 people on 2 days. Please clear the cost with budget yourself.' } },
              { tool: 'askPeer', args: { peer: 'travel', request: '14 international speakers. Please book them. What does travel cost?' } },
              { tool: 'readBoard', args: {} },
              PLACE,
            ],
            (c) => {
              const board = out(c, 'readBoard');
              const travel = firstEur(out(c, 'askPeer'), 'international speakers');
              return finalPlan(
                { venue: firstEur(board, 'Room D'), catering: firstEur(board, 'Rheinküche'), travel, captions: firstEur(board, 'captions'), total: firstEur(board, 'Plan'), buffer: firstEur(board, 'Buffer') },
                ` Budget checked travel as an estimate of €20,000 before Travel booked ${eur(travel)}, and nobody checked again. The Budget screen shows it.`,
              );
            },
          )(ctx),
  'peer-venue': seq(
    [
      { tool: 'listRooms', args: {} },
      { tool: 'askPeer', args: { peer: 'access', request: 'Are Hall A, Room B, Room C and Room D step-free? Anything else I should know?' } },
      { tool: 'quoteVenue', args: { rooms: PLAN_ROOMS } },
      par(ASSIGN_FINAL, risk(RISK.overflow)),
      (c) => ({ tool: 'postToBoard', args: { section: 'venue', note: `Hall A (keynote and Agents), Room B, Room D. Room C dropped (stairs). ${eur(num(out(c, 'quoteVenue'), 'totalEur'))} incl. AV. Keynote overflow streams to Room B.` } }),
    ],
    (c) => `Hall A, Room B, Room D: ${eur(num(out(c, 'quoteVenue'), 'totalEur'))}. Room C is out (accessibility). Keynote needs an overflow stream.`,
  ),
  'peer-access': seq(
    [
      par({ tool: 'checkRoomAccess', args: { rooms: [...ALL_ROOMS, 'Foyer'] } }, { tool: 'quoteCaptioning', args: { rooms: ['Hall A'] } }),
      par(MARKS, CAPTIONS),
      { tool: 'postToBoard', args: { section: 'access', note: 'Room C stairs only, do not use. Live captions Hall A: €3,800.' } },
    ],
    () => 'Room C is not step-free, do not use it. Hall A has an induction loop; captions there cost €3,800.',
  ),
  'peer-catering': seq(
    [
      { tool: 'dietaryStats', args: {} },
      { tool: 'quoteCatering', args: { caterer: 'Rheinküche', headcount: 600 } },
      CATER,
      { tool: 'askPeer', args: { peer: 'budget', request: 'Catering Rheinküche €69,600 for 600 people on 2 days. Does that fit? Venue and access are on the board.' } },
      { tool: 'postToBoard', args: { section: 'catering', note: 'Rheinküche, vegan included: €69,600.' } },
    ],
    () => 'Rheinküche, €69,600 for 600 people on 2 days. Budget confirmed it fits.',
  ),
  'peer-budget': (ctx) =>
    /catering/i.test(ctx.lastUserText)
      ? seq(
          [
            { tool: 'getBudget', args: {} },
            { tool: 'readBoard', args: {} },
            { tool: 'askPeer', args: { peer: 'marketing', request: 'How much sponsor money is signed, and what is the ticket forecast?' } },
            // travel has not reported yet: the budget peer estimates it. That number is what goes stale.
            { tool: 'checkPlan', args: { items: [{ item: 'Venue', eur: 38600 }, { item: 'Catering', eur: 69600 }, { item: 'Travel (estimate)', eur: 20000 }, { item: 'Captions', eur: 3800 }] } },
            {
              tool: 'recordBudgetCheck',
              args: {
                lines: [
                  { domain: 'venue', eur: 38600 },
                  { domain: 'catering', eur: 69600 },
                  { domain: 'travel', eur: 20000, estimate: true },
                  { domain: 'access', eur: 3800 },
                ],
              },
            },
            (c) => ({ tool: 'postToBoard', args: { section: 'budget', note: `Plan ${eur(num(out(c, 'checkPlan'), 'totalEur'))} of €180,000 (travel estimated). Buffer ${eur(num(out(c, 'checkPlan'), 'bufferEur'))}.` } }),
          ],
          (c) => `Fits: ${eur(num(out(c, 'checkPlan'), 'totalEur'))} of €180,000 with travel estimated, buffer ${eur(num(out(c, 'checkPlan'), 'bufferEur'))}. €35,000 sponsors signed.`,
        )(ctx)
      : seq(
          [
            { tool: 'readBoard', args: {} },
            (c) => ({ tool: 'checkPlan', args: { items: [{ item: 'Speaker travel', eur: firstEur(c.lastUserText) }] } }),
            (c) => ({ tool: 'recordBudgetCheck', args: { lines: [{ domain: 'travel', eur: firstEur(c.lastUserText) }] } }),
            (c) => ({ tool: 'postToBoard', args: { section: 'budget', note: `Travel ${eur(firstEur(c.lastUserText))} checked. Total ${eur(num(out(c, 'checkPlan'), 'totalEur'))} of €180,000.` } }),
          ],
          (c) => `Travel fits: total ${eur(num(out(c, 'checkPlan'), 'totalEur'))} of €180,000, buffer ${eur(num(out(c, 'checkPlan'), 'bufferEur'))}.`,
        )(ctx),
  'peer-marketing': seq(
    [par({ tool: 'sponsorPipeline', args: {} }, { tool: 'ticketForecast', args: {} }), par(risk(RISK.tickets), risk(RISK.aiforge))],
    () => 'Sponsors signed €35,000 (pipeline €60,000). 412 tickets sold, forecast 590.',
  ),
  'peer-travel': (ctx) =>
    isTravelRequest(ctx.lastUserText)
      ? seq(
          [
            par(READ_PASSPORTS, QUOTE_FLIGHTS, QUOTE_HOTEL),
            (c) => par(visaChecks(c), propose(c, SPEAKERS, 3), ...visaRisks(c)),
            (c) => ({ tool: 'postToBoard', args: { section: 'travel', note: `14 speakers proposed, travel cost ${eur(travelEur(c))}, waiting for approval. 1 visa needed, 1 passport renewal.` } }),
          ],
          travelAnswer,
        )(ctx)
      : seq(
          [
            par({ tool: 'listInternationalSpeakers', args: {} }, { tool: 'quoteTravel', args: { nights: 3 } }),
            TRAVEL,
            (c) => ({ tool: 'postToBoard', args: { section: 'travel', note: `14 speakers proposed: ${eur(num(out(c, 'quoteTravel'), 'totalEur'))}.` } }),
          ],
          (c) => `14 international speakers proposed, ${eur(num(out(c, 'quoteTravel'), 'totalEur'))} incl. 3 hotel nights, waiting for approval.`,
        )(ctx),
};

/** The stage requests first (by the request the agent's setup works on), the big requests otherwise. */
export const plannerMockScripts: Record<string, MockScript> = Object.fromEntries(
  Object.entries(bigRequests).map(([id, big]) => [
    id,
    (ctx: MockCtx) => {
      const kind = currentRequest(modeOf(id));
      const stage = kind === 'rooms' || kind === 'travelUs' ? STAGE[id]?.[kind] : undefined;
      return (stage ?? big)(ctx);
    },
  ]),
);
