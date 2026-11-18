// Three ways to plan the same conference:
//   single         one agent, every read and write tool
//   centralized    a triage agent delegates to 7 specialists, over A2A (remote agents) or in process
//   decentralized  peer to peer with a shared board: 7 peers, nobody in charge, they call each other over A2A
// Four requests (requests.ts): the stage requests "rooms" and "travelUs", and the big "conference" and "travel".
// Each agent gets the brief of the request its setup is working on (the plan store knows it), so prompts stay short,
// the triage can only reach the specialists that request needs, and every run carries the request kind as trace metadata.
import { Agent } from '@mastra/core/agent';
import { A2AAgent } from '@mastra/core/a2a';
import { model } from '../model/models';
import { EVENT } from './data';
import { redactPassports } from './passport';
import { peerTools, PLANNER_URL, setLocalResolver, transport } from './peers';
import { currentRequest, type PlanMode } from './plan-store';
import { REQUESTS, type RequestKind } from './requests';
import { allDomainTools, DOMAINS, domainTools, type Domain } from './tools';
import { emit, vizId } from './viz';

const EVENT_BRIEF = `Event: ${EVENT.name} in ${EVENT.city}, ${EVENT.dates.replace('–', ' to ')}, ${EVENT.attendees} attendees, tracks ${EVENT.tracks.join(', ')}, budget €${EVENT.budgetEur.toLocaleString('en-US')}.`;

/** The plan lives in a shared plan store that the UI shows. Agents must record decisions there, not only in text. */
const WRITE_RULE = `Tools marked WRITE record your decisions in the shared plan that the event team sees. Every decision in your area must be written with them; text alone does not change the plan. Write in batches: one call can carry several items. Make independent tool calls in the same step.`;
const APPROVAL_RULE = 'Bookings need a person: bookTravel, bookFlights and bookHotel only create a proposal that waits for approval. You cannot approve. When a tool says "waiting for approval", stop and report the proposal with its total.';

/** Specialists and peers: short answers to whoever asked. */
const SHORT = 'Answer in at most 3 short sentences with the numbers. No tables, no lists, no dashes as punctuation, no arrows.';
/** The final answer to the user (single agent, triage). */
const FINAL = 'Answer the user in at most 5 short sentences. No tables, no lists. Do not repeat the plan; point to the screens instead (Overview, Rooms, Travel, Budget). Use no dashes as punctuation, no arrows and no buzzwords.';

// ---------- what each domain does, per request ----------
const BRIEF: Record<RequestKind, Partial<Record<Domain, string>>> = {
  rooms: {
    venue: 'Assign Hall A to the keynotes and one room per track (Agents, AI Engineering, AI in Practice) with one assignRooms call. Never keep a room that Accessibility says is not step-free: drop it with dropRoom and move its track (Hall A can hold the keynotes and a track).',
    access: 'Check Hall A, Room B, Room C and Room D with checkRoomAccess and record all of them with one markRooms call.',
    budget: 'Record the budget check with recordBudgetCheck: one venue line with the venue cost.',
  },
  travelUs: {
    travel:
      'Book the four shortlisted speakers from the US. Step 1: listInternationalSpeakers with country US. Step 2, in one step for all four: readPassports, quoteFlights, and quoteHotel with 3 nights. Step 3, in one step: recordVisaChecks for all four, and bookTravel with the flight offers that arrive by 10 May and the cheaper hotel offer. If a booking was declined: read lastProposal, then call bookTravel once with the same offers, changed as the reason says (for example fewer nights). Passport numbers stay with you: never put them into answers, notes, risks or messages.',
    budget: 'Record the budget check with recordBudgetCheck: one travel line with the travel total you were given.',
  },
  conference: {
    program: 'Schedule 10 talks per track, best rated first (shortlistTalks), with one placeTalks call for all three tracks. Flag program risks with flagRisk.',
    venue: 'Assign the keynote room, one room per track and the keynote overflow room with one assignRooms call. Never use a room that Accessibility says is not step-free; if you assigned one, take it out with dropRoom and give its track another room. Flag venue risks, for example the keynote overflow, with flagRisk.',
    catering: 'Choose the caterer with chooseCaterer for all attendees. The menu must cover vegan guests.',
    travel: 'Propose travel for every shortlisted international speaker with one bookTravel call at list prices (3 hotel nights).',
    budget: 'Record your check with recordBudgetCheck: one line per domain (venue, catering, travel, and access for captions). Mark any value you estimated yourself as estimate.',
    marketing: 'Flag ticket and sponsor risks with flagRisk.',
    access: 'Check every room, the Foyer included, and record all of them with one markRooms call. Book live captions for the keynote room with bookCaptions.',
  },
  travel: {
    travel:
      'Get the speakers with listInternationalSpeakers, then in one step for all of them readPassports, quoteFlights and quoteHotel (3 nights). Then in one step record every visa status with one recordVisaChecks call and propose one bookTravel with the flight offers that arrive by 10 May and the cheaper hotel offer. Flag visa and passport problems with flagRisk. Passport numbers stay with you: never put them into answers, notes, risks or messages.',
    program: 'Schedule 10 talks per track, best rated first (shortlistTalks), with one placeTalks call for all three tracks.',
    budget: 'Record a budget check with the travel cost from Travel (one travel line).',
  },
};

const ROLE: Record<Domain, { name: string; contract: string }> = {
  program: { name: 'Program Chair', contract: 'Owns the CFP submissions and the schedule. Returns shortlists and the schedule. Does not book rooms.' },
  venue: { name: 'Venue Manager', contract: 'Owns rooms, availability and venue prices. Returns room plans with seats and cost. Does not decide the program.' },
  catering: { name: 'Catering Lead', contract: 'Owns caterers, menus and dietary data. Returns a catering quote. Does not approve budget.' },
  travel: { name: 'Speaker Travel', contract: 'Owns speaker travel, the passport registry and the airline and hotel systems. Returns travel cost and visa status. Never shares passport numbers.' },
  budget: { name: 'Budget Controller', contract: 'Owns the budget ledger. Checks planned costs against the budget and reports the buffer.' },
  marketing: { name: 'Marketing', contract: 'Owns ticket sales and sponsors. Returns forecasts and signed sponsor money.' },
  access: { name: 'Accessibility', contract: 'Owns accessibility checks (step-free access, hearing support, captions). Flags rooms that exclude people.' },
};
const brief = (kind: RequestKind, d: Domain) => BRIEF[kind][d] ?? 'This request does not need your domain. Say so in one sentence.';
/** Every run carries the request kind and the setup as trace metadata (Studio > Traces). */
const tracing = (mode: PlanMode, agent: string) => ({ metadata: { requestKind: currentRequest(mode), setup: mode, agent } });

// ---------- (a) single agent ----------
const SINGLE_STEPS: Record<RequestKind, number> = { rooms: 8, travelUs: 8, conference: 20, travel: 16 };
export const plannerSingle = new Agent({
  id: 'planner-single',
  name: 'Conference Planner (single agent)',
  description: 'Plans the whole conference alone, with every tool.',
  instructions: () => {
    const kind = currentRequest('single');
    const parts = REQUESTS[kind].domains.map((d) => brief(kind, d)).join(' ');
    return `You plan a developer conference end to end. ${EVENT_BRIEF}
You hold every tool: program, venue, catering, travel (with the passport registry and the airline and hotel systems), budget, marketing and accessibility. ${WRITE_RULE} ${APPROVAL_RULE}
The current request: ${REQUESTS[kind].text}
Do this: ${parts}
${FINAL}`;
  },
  model: model('planner-single', 'large'),
  tools: allDomainTools('planner-single'),
  defaultOptions: () => ({ maxSteps: SINGLE_STEPS[currentRequest('single')], tracingOptions: tracing('single', 'planner-single') }),
});

const SPECIALIST_STEPS: Record<Domain, number> = { program: 5, venue: 5, catering: 5, travel: 6, budget: 4, marketing: 4, access: 4 };

// ---------- specialists (used by the centralized network) ----------
export const specialists = Object.fromEntries(
  DOMAINS.map((d) => [
    d,
    new Agent({
      id: `spec-${d}`,
      name: ROLE[d].name,
      description: ROLE[d].contract,
      instructions: () => `You are the ${ROLE[d].name} of ${EVENT.name}. ${ROLE[d].contract} ${EVENT_BRIEF}
${WRITE_RULE}${d === 'travel' ? ` ${APPROVAL_RULE}` : ''} ${brief(currentRequest('centralized'), d)}
Use your tools and answer the hub. ${SHORT}`,
      model: model(`spec-${d}`, 'small'),
      tools: domainTools(d, `spec-${d}`),
      defaultOptions: () => ({ maxSteps: SPECIALIST_STEPS[d], tracingOptions: tracing('centralized', `spec-${d}`) }),
    }),
  ]),
) as unknown as Record<Domain, Agent>;

// Over A2A the triage agent only knows each specialist's agent card: name, description, URL. Not its tools, prompt or memory.
const remoteSpecialists = Object.fromEntries(
  DOMAINS.map((d) => [d, new A2AAgent({ id: d, name: ROLE[d].name, description: ROLE[d].contract, url: `${PLANNER_URL}/api/.well-known/spec-${d}/agent-card.json`, timeoutMs: 120_000 })]),
);

// ---------- (b) centralized ----------
const delegationStarted = new Map<string, number>();
const specOf = (id: unknown) => String(id).replace(/^spec-/, '');
/** The hub's delegation hooks: report every message on the viz bus, and redact what comes back. */
export const triageDelegation = {
  hookErrorStrategy: 'throw' as const,
  onDelegationStart: async (ctx: any) => {
    delegationStarted.set(`${ctx.toolCallId}`, Date.now());
    emit({ type: 'message', mode: 'centralized', from: 'triage', to: specOf(ctx.primitiveId), text: String(ctx.prompt ?? ''), via: transport() === 'a2a' ? 'a2a' : 'delegation', id: `${ctx.toolCallId}` });
    return { proceed: true };
  },
  // what leaves a specialist is redacted: passport numbers stay with Travel
  onDelegationComplete: async (ctx: any) => {
    const id = `${ctx.toolCallId ?? vizId()}`;
    const t0 = delegationStarted.get(id);
    delegationStarted.delete(id);
    const { text, count } = redactPassports(String(ctx.result?.text ?? ''));
    emit({ type: 'reply', mode: 'centralized', from: specOf(ctx.primitiveId), to: 'triage', text, id, ms: t0 ? Date.now() - t0 : undefined, ...(count ? { redacted: count } : {}) });
    return count ? { resultText: text } : undefined;
  },
};

// How the hub splits each request. It can only reach the specialists the request needs (see agents below).
const TRIAGE_PLAN: Record<RequestKind, string> = {
  rooms: 'Ask venue (assign the rooms) and access (check step-free access of every room) in the same step. Specialists cannot talk to each other: if access finds a room that is not step-free, tell venue to drop it and move its track. Then ask budget to check the venue cost, with the number.',
  travelUs:
    'Ask travel to propose flights and hotels for the four US speakers. Then ask budget to check the proposed travel total, with the number. If the user says a booking was declined, pass the reason to travel and ask for a new proposal, then ask budget with the new total. Never ask for passport numbers.',
  conference:
    'Ask program, venue, access, catering, travel and marketing at once. Specialists cannot talk to each other: pass findings on, for example a room that is not step-free goes to venue. Ask budget last, with all costs.',
  travel: 'Ask travel (it holds the passports and the airline and hotel systems) and program at once. Then budget with the travel cost. Never ask for passport numbers.',
};
const TRIAGE_STEPS: Record<RequestKind, number> = { rooms: 6, travelUs: 6, conference: 8, travel: 6 };
export const plannerTriage = new Agent({
  id: 'planner-triage',
  name: 'Conference Triage (centralized)',
  description: 'Hub of the centralized network: splits the request, delegates to specialists, merges the answers.',
  instructions: () => {
    const kind = currentRequest('centralized');
    return `You coordinate ${EVENT.name}. ${EVENT_BRIEF}
You have no domain tools. Delegate to the specialists you have (${REQUESTS[kind].domains.join(', ')}). Each one records its own decisions in the shared plan; tell them to do so.
Ask specialists whose work does not depend on each other in the same step, so they work at the same time. ${APPROVAL_RULE}
The current request: ${REQUESTS[kind].text}
${TRIAGE_PLAN[kind]}
${FINAL}`;
  },
  model: model('planner-triage', 'large'),
  // routing in code: the hub only gets the specialists this request needs
  agents: () => {
    const all: Record<string, any> = transport() === 'a2a' ? remoteSpecialists : specialists;
    return Object.fromEntries(REQUESTS[currentRequest('centralized')].domains.map((d) => [d, all[d]])) as any;
  },
  defaultOptions: () => ({ maxSteps: TRIAGE_STEPS[currentRequest('centralized')], delegation: triageDelegation, tracingOptions: tracing('centralized', 'planner-triage') }) as any,
});

// ---------- (c) decentralized: peer to peer with a shared board ----------
// Who a peer should ask, per request. The network has no hub, so each peer must know its own dependencies.
const PEER_ASKS: Record<RequestKind, Partial<Record<Domain, string>>> = {
  rooms: {
    venue:
      'You receive the user request. First assign the rooms with one assignRooms call and post them with the venue cost to the board. Then ask access (are the rooms step-free?) and budget (check the venue cost on the board) in the same step. If access names a room that is not step-free, drop it, move its track and post the new venue cost.',
    budget: 'Read the board for the venue cost first.',
  },
  travelUs: {
    travel: 'You receive the user request. Propose the booking, post the proposed total to the board, then ask budget to check it.',
  },
  conference: {
    program: 'You receive the user request. Ask venue, catering and travel at once, then schedule the talks.',
    venue: 'Before you assign rooms, ask access which rooms are step-free.',
    catering: 'Ask budget whether your cost fits.',
    budget: 'Read the board first. Ask the owners for costs that are missing; if you estimate a value, mark it as estimate.',
  },
  travel: {
    program: 'You receive the user request. Ask travel to book (it holds the passports and the airline and hotel systems) and schedule the talks in the same step; then ask budget to check the travel cost.',
  },
};
const PEER_STEPS: Record<Domain, number> = { program: 10, venue: 8, catering: 6, travel: 8, budget: 5, marketing: 4, access: 4 };

export const peers = Object.fromEntries(
  DOMAINS.map((d) => [
    d,
    new Agent({
      id: `peer-${d}`,
      name: `${ROLE[d].name} (peer)`,
      description: ROLE[d].contract,
      instructions: () => {
        const kind = currentRequest('decentralized');
        return `You are the ${ROLE[d].name} of ${EVENT.name}, one of seven peers. Nobody is in charge.
${ROLE[d].contract} ${EVENT_BRIEF}
${WRITE_RULE}${d === 'travel' ? ` ${APPROVAL_RULE}` : ''} ${brief(kind, d)}
If your part depends on another domain, ask that peer directly with askPeer. ${PEER_ASKS[kind][d] ?? ''} Post your result to the board.
Requests from peers start with [from <peer>]: answer them. ${SHORT}`;
      },
      model: model(`peer-${d}`, 'small'),
      tools: { ...domainTools(d, `peer-${d}`), ...peerTools(`peer-${d}`) },
      defaultOptions: () => ({ maxSteps: PEER_STEPS[d], tracingOptions: tracing('decentralized', `peer-${d}`) }),
    }),
  ]),
) as unknown as Record<Domain, Agent>;
setLocalResolver((id) => peers[id.replace(/^peer-/, '') as Domain]);

/** The peer a request enters at: rooms at Venue, travelUs at Travel, the big requests at Program. */
export const entryPeerFor = (kind: RequestKind) => peers[REQUESTS[kind].entry];

/**
 * The user has to talk to someone. In the peer network that depends on the request (the plan store knows it),
 * so the UI's one "decentralized" agent forwards to the right entry peer.
 */
export const plannerEntryPeer: Agent = new Proxy(peers.program, {
  get(_target, prop) {
    const peer = entryPeerFor(currentRequest('decentralized')) as any;
    const v = Reflect.get(peer, prop, peer);
    return typeof v === 'function' ? v.bind(peer) : v;
  },
});

/** All planner agents, keyed by id (so A2A URLs are /api/a2a/<id>). */
export const plannerAgents: Record<string, Agent> = {
  'planner-single': plannerSingle,
  'planner-triage': plannerTriage,
  ...Object.fromEntries(DOMAINS.map((d) => [`spec-${d}`, specialists[d]])),
  ...Object.fromEntries(DOMAINS.map((d) => [`peer-${d}`, peers[d]])),
};
