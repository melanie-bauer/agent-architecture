// The demo requests. Same texts as src/mastra/planner/requests.ts on the server.
// rooms and travelUs are the two stage requests (main buttons); the big ones sit under "More requests".
import type { RequestKind } from './network';

export const REQUESTS: Record<RequestKind, { title: string; text: string; short: string }> = {
  rooms: {
    title: 'Assign rooms',
    short: 'Venue, accessibility and budget: three tracks, step-free rooms, venue cost.',
    text: 'Assign rooms for the three tracks and check the venue cost against the budget.',
  },
  travelUs: {
    title: 'Book US speakers',
    short: 'Travel and budget: passports, slow airline and hotel systems, a person approves.',
    text: 'Book flights and hotels for the four speakers from the US and check the cost against the budget.',
  },
  conference: {
    title: 'Plan the conference',
    short: 'Rooms, schedule, catering, travel, budget and risks.',
    text: 'Plan VibeKode 2027 (Mainz, 11 and 12 May, 600 attendees, 3 tracks, budget €180,000). Make a draft plan and record it: rooms, schedule, catering, speaker travel, total cost vs budget, and the open risks.',
  },
  travel: {
    title: 'Book speaker travel',
    short: 'All 14 speakers: passports, airline and hotel systems, schedule and budget.',
    text: 'Book travel for the 14 international speakers of VibeKode 2027. Check every passport and visa, get flight and hotel quotes from the airline and hotel systems and book them, put all 30 talks into the schedule, and check the travel cost against the budget.',
  },
};
export const MAIN_REQUESTS: RequestKind[] = ['rooms', 'travelUs'];
export const MORE_REQUESTS: RequestKind[] = ['conference', 'travel'];

/** A request typed into the chat: the exact text of a known request, otherwise a guess from its words.
 *  null: no request recognised (a question, a correction): the chat treats it as a follow-up to the current request. */
export function kindOf(text: string): RequestKind | null {
  const t = text.trim();
  const exact = (Object.keys(REQUESTS) as RequestKind[]).find((k) => REQUESTS[k].text === t);
  if (exact) return exact;
  if (/\bUS\b|four speakers/i.test(t)) return 'travelUs';
  if (/passport|visa|flight|hotel/i.test(t)) return 'travel';
  if (/room/i.test(t) && !/catering|schedule/i.test(t)) return 'rooms';
  if (/plan (the|a|our) conference|whole conference|catering/i.test(t)) return 'conference';
  return null;
}

/** Where a request enters the peer network (decentralized): rooms at Venue, travelUs at Travel, the big ones at Program. */
export const ENTRY: Record<RequestKind, 'venue' | 'travel' | 'program'> = { rooms: 'venue', travelUs: 'travel', conference: 'program', travel: 'program' };

/** The domains a request needs (same as the server's requests.ts): the triage asks only these. */
export const REQUEST_DOMAINS: Record<RequestKind, string[]> = {
  rooms: ['venue', 'access', 'budget'],
  travelUs: ['travel', 'budget'],
  conference: ['program', 'venue', 'catering', 'travel', 'budget', 'marketing', 'access'],
  travel: ['travel', 'program', 'budget'],
};
