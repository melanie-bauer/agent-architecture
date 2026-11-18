// Fictional data for "VibeKode 2027", an AI-focused developer conference. Seven domains, seven data sources, constraints that collide.
// Every name, talk, price and number here is made up for the demo.
export const EVENT = {
  name: 'VibeKode 2027',
  city: 'Mainz',
  dates: '11–12 May 2027',
  days: 2,
  attendees: 600,
  tracks: ['Agents', 'AI Engineering', 'AI in Practice'],
  budgetEur: 180_000,
};
export type Track = 'Agents' | 'AI Engineering' | 'AI in Practice';

/** Speakers from these countries travel by train; everyone else needs a flight. */
export const LOCAL = ['DE', 'AT', 'CH'];
export const FLIGHT_EUR: Record<string, number> = { US: 1100, UK: 280, NL: 220, PL: 260, IN: 950, BR: 1250 };
export const HOTEL_EUR_PER_NIGHT = 200;

// [title, speaker, origin, rating]. The 10 best-rated talks per track carry 14 international speakers.
type Row = [string, string, string, number];
const CFP: Record<Track, Row[]> = {
  Agents: [
    ['Supervisor or swarm?', 'Hannah Keller', 'DE', 4.6],
    ['A2A across company borders', 'Marcus Reed', 'US', 4.9],
    ['Agent cards in practice', 'Lena Vogt', 'DE', 3.6],
    ['Handoffs that keep context', 'Oliver Grant', 'UK', 4.4],
    ['Memory boundaries for agents', 'Jonas Brandt', 'DE', 4.2],
    ['Tool permissions per agent', 'Sanne de Vries', 'NL', 4.7],
    ['Human in the loop UX', 'Miriam Hofer', 'AT', 4.1],
    ['Observability for agent networks', 'Dana Whitfield', 'US', 4.5],
    ['Testing multi-agent systems', 'Tobias Kurz', 'DE', 3.4],
    ['When one agent is enough', 'Felix Wagner', 'DE', 4.3],
    ['Blackboards and shared state', 'Emily Carter', 'US', 3.8],
    ['Agent protocols compared', 'Lucas Ferreira', 'BR', 4.8],
    ['Long-running agent tasks', 'Paul Neumann', 'DE', 3.1],
    ['Agents in regulated industries', 'Sophie Lang', 'CH', 4.0],
    ['Cost control for agent networks', 'Anna Berger', 'AT', 3.5],
  ],
  'AI Engineering': [
    ['Evals in CI', 'Stefan Richter', 'DE', 4.8],
    ['RAG that survives users', 'Kevin Brooks', 'US', 4.6],
    ['Small models, big wins', 'Julia Weber', 'DE', 3.7],
    ['Prompt injection field guide', 'Amelia Hughes', 'UK', 4.9],
    ['MCP servers for the enterprise', 'Piotr Nowak', 'PL', 4.4],
    ['Structured outputs everywhere', 'Laura Schmid', 'DE', 4.1],
    ['Vector search on Postgres', 'Ravi Menon', 'IN', 3.3],
    ['Fine-tuning or context?', 'Ananya Rao', 'IN', 4.7],
    ['Streaming UIs with AG-UI', 'Daniel Huber', 'AT', 4.3],
    ['Guardrails without theatre', 'Max Lehmann', 'DE', 3.6],
    ['Caching LLM calls', 'Nina Roth', 'DE', 4.0],
    ['Model routing in production', 'Beatriz Costa', 'BR', 4.5],
    ['Tracing LLM apps', 'Clara Wolf', 'DE', 3.2],
    ['Synthetic test data', 'Matthias Frei', 'CH', 4.2],
    ['Latency budgets for AI features', 'Tom Fischer', 'DE', 3.0],
  ],
  'AI in Practice': [
    ['AI code review in practice', 'Lisa Hartmann', 'DE', 4.7],
    ['Copilots for ops teams', 'Rachel Kim', 'US', 4.9],
    ['Vibe coding meets legacy code', 'Martin Gruber', 'AT', 4.5],
    ['Shipping an AI feature in six weeks', 'James Whitaker', 'UK', 4.8],
    ['AI pair programming for teams', 'Jan Schulz', 'DE', 3.6],
    ['Support bots that hand over', 'Eva Koch', 'DE', 4.2],
    ['Document AI in insurance', 'Daan Bakker', 'NL', 4.6],
    ['AI in the IDE, measured', 'Olivia Bennett', 'UK', 3.8],
    ['Accessibility with AI tools', 'Simon Meier', 'CH', 4.1],
    ['Agents for incident response', 'Katarzyna Zielinska', 'PL', 4.4],
    ['Spec-driven development with AI', 'Moritz Kraus', 'DE', 3.5],
    ['Data privacy for AI features', 'Katrin Seidel', 'DE', 4.3],
    ['Teaching juniors with AI', 'Sarah Neumann', 'DE', 3.4],
    ['AI for test automation', 'Benedikt Lorenz', 'DE', 4.0],
    ['Product discovery with LLMs', 'Florian Pichler', 'AT', 3.2],
    ['Running AI on premises', 'Helena Jung', 'DE', 3.9],
  ],
};

export const submissions = (EVENT.tracks as Track[]).flatMap((track, ti) =>
  CFP[track].map(([title, speaker, origin, rating], i) => ({
    id: `S-${ti + 1}${String(i + 1).padStart(2, '0')}`,
    track,
    title,
    speaker,
    speakerId: `SP-${ti + 1}${String(i + 1).padStart(2, '0')}`,
    origin,
    rating,
  })),
);
export type Submission = (typeof submissions)[number];

/** The program committee's shortlist rule: the best-rated talks of each track. */
export const shortlist = (slotsPerTrack: number) =>
  (EVENT.tracks as Track[]).map((track) => ({
    track,
    talks: submissions.filter((s) => s.track === track).sort((a, b) => b.rating - a.rating).slice(0, slotsPerTrack),
  }));
export const TALKS_PER_TRACK = 10;
const shortlisted = new Set(shortlist(TALKS_PER_TRACK).flatMap((t) => t.talks.map((s) => s.id)));

export const speakers = submissions.map((s) => ({
  id: s.speakerId,
  name: s.speaker,
  origin: s.origin,
  submissionId: s.id,
  talk: s.title,
  track: s.track,
  shortlisted: shortlisted.has(s.id),
  needsFlight: !LOCAL.includes(s.origin),
  flightEur: FLIGHT_EUR[s.origin] ?? 0,
}));
export type Speaker = (typeof speakers)[number];

/** Shortlisted speakers who need a flight, grouped by country (14 people). */
const travellers = speakers.filter((s) => s.shortlisted && s.needsFlight);
export const internationalSpeakers = Object.entries(
  travellers.reduce<Record<string, number>>((m, s) => ((m[s.origin] = (m[s.origin] ?? 0) + 1), m), {}),
).map(([from, count]) => ({ from, count, flightEur: FLIGHT_EUR[from] }));
export const travellingSpeakers = travellers.map((s) => ({ id: s.id, name: s.name, origin: s.origin, flightEur: s.flightEur }));

export const rooms = [
  { id: 'Hall A', seats: 450, eurPerDay: 9000, stepFree: true, inductionLoop: true },
  { id: 'Room B', seats: 220, eurPerDay: 3200, stepFree: true, inductionLoop: false },
  { id: 'Room C', seats: 180, eurPerDay: 2800, stepFree: false, inductionLoop: false }, // stairs only
  { id: 'Room D', seats: 160, eurPerDay: 2600, stepFree: true, inductionLoop: false },
  { id: 'Foyer', seats: 700, eurPerDay: 0, stepFree: true, inductionLoop: false, note: 'catering + expo only' },
];
export const BOOKABLE_ROOMS = ['Hall A', 'Room B', 'Room C', 'Room D'] as const;
export const AV_PER_DAY = 4500;
export const availability: Record<string, string> = {
  'Hall A': 'free both days',
  'Room B': 'free both days',
  'Room C': 'free both days',
  'Room D': 'free both days (until 18:00)',
};

/** Schedule skeleton: opening keynote, 5 track slots per day, closing keynote. */
export const SLOTS = [
  { day: 1, slot: 1, time: '10:30' },
  { day: 1, slot: 2, time: '11:30' },
  { day: 1, slot: 3, time: '13:30' },
  { day: 1, slot: 4, time: '14:30' },
  { day: 1, slot: 5, time: '16:00' },
  { day: 2, slot: 1, time: '09:00' },
  { day: 2, slot: 2, time: '10:00' },
  { day: 2, slot: 3, time: '11:30' },
  { day: 2, slot: 4, time: '13:30' },
  { day: 2, slot: 5, time: '14:30' },
];
export const KEYNOTES = [
  { day: 1, time: '09:00', title: 'Opening keynote' },
  { day: 2, time: '16:00', title: 'Closing keynote' },
];

export const caterers = [
  { id: 'Rheinküche', eurPerPersonDay: 58, vegan: true, glutenFree: true, note: 'lunch, 2 coffee breaks, water' },
  { id: 'Mainzer Tafel', eurPerPersonDay: 49, vegan: false, glutenFree: true, note: 'no vegan menu' },
];
export const dietary = { vegetarian: '31 %', vegan: '12 %', glutenFree: '4 %', basedOn: '412 registrations so far' };

export const ledger = { budgetEur: 180_000, committed: [{ item: 'Marketing campaign (signed)', eur: 12_000 }] };
export const sponsors = { signedEur: 35_000, pipelineEur: 60_000, top: ['CloudCo (Gold, signed)', 'DataWorks (Silver, signed)', 'AIForge (Gold, negotiating)'] };
export const tickets = { sold: 412, forecastByEvent: 590, cap: 600, priceEur: 499 };
export const captioning = { eurPerRoomDay: 1900, note: 'live captions EN, CART provider' };

// ---------------- second request: speaker travel ----------------
/** All bookable spaces including the Foyer (Accessibility checks the Foyer too, it hosts catering and the expo). */
export const ROOM_IDS = ['Hall A', 'Room B', 'Room C', 'Room D', 'Foyer'] as const;

/** Speakers fly in on 10 May and leave on 13 May (3 hotel nights). */
export const ARRIVE_BY = '2027-05-10';
export const CHECK_IN = '2027-05-10';
export const CHECK_OUT = '2027-05-13';

/**
 * Fake passport registry. Readable only through Travel's readPassports tool.
 * Every number is made up; the PX prefix makes them easy to find in prompts and logs.
 */
const PASSPORT_EXPIRY: Record<string, string> = { 'James Whitaker': '2027-07-02' }; // expires less than 3 months after the trip
export const passports = travellingSpeakers.map((s, i) => ({
  speakerId: s.id,
  name: s.name,
  nationality: s.origin,
  passportNo: `PX${String(4820193 + i * 7919).padStart(7, '0')}`,
  expires: PASSPORT_EXPIRY[s.name] ?? `${2029 + (i % 4)}-0${1 + (i % 9)}-15`,
}));
export const VISA_RULES =
  'Germany (Schengen), stay of 3 nights: citizens of IN need a Schengen visa (send an invitation letter). Citizens of US, UK, BR, NL and PL need no visa. The passport must be valid until at least 13 Aug 2027 (3 months after departure on 13 May).';
