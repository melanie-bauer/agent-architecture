// The demo requests. The UI keeps the same texts in ui-planner/src/requests.ts.
// rooms and travelUs are the two short stage requests; conference and travel are the big ones (under "More requests").
// Each request names the domains it needs (the triage may only ask those) and the peer it enters at in the decentralized setup.
// "open" is whatever a person types into the chat: no fixed brief, every domain, and in the decentralized setup a router picks the entry peer.
import type { Domain } from './tools';

export type RequestKind = 'rooms' | 'travelUs' | 'conference' | 'travel' | 'open';
export const REQUEST_KINDS: RequestKind[] = ['rooms', 'travelUs', 'conference', 'travel', 'open'];

export const REQUESTS: Record<RequestKind, { title: string; text: string; domains: Domain[]; entry: Domain }> = {
  rooms: {
    title: 'Assign rooms',
    text: 'Assign rooms for the three tracks and check the venue cost against the budget.',
    domains: ['venue', 'access', 'budget'],
    entry: 'venue',
  },
  travelUs: {
    title: 'Book US speakers',
    text: 'Book flights and hotels for the four speakers from the US and check the cost against the budget.',
    domains: ['travel', 'budget'],
    entry: 'travel',
  },
  conference: {
    title: 'Plan the conference',
    text: 'Plan VibeKode 2027 (Mainz, 11 and 12 May, 600 attendees, 3 tracks, budget €180,000). Make a draft plan and record it: rooms, schedule, catering, speaker travel, total cost vs budget, and the open risks.',
    domains: ['program', 'venue', 'catering', 'travel', 'budget', 'marketing', 'access'],
    entry: 'program',
  },
  travel: {
    title: 'Book speaker travel',
    text: 'Book travel for the 14 international speakers of VibeKode 2027. Check every passport and visa, get flight and hotel quotes from the airline and hotel systems and book them, put all 30 talks into the schedule, and check the travel cost against the budget.',
    domains: ['travel', 'program', 'budget'],
    entry: 'program',
  },
  // the text is the person's own (Run.text in the plan store); the entry is the router's pick (Run.entry), program only as a fallback
  open: {
    title: 'Own request',
    text: '',
    domains: ['program', 'venue', 'catering', 'travel', 'budget', 'marketing', 'access'],
    entry: 'program',
  },
};

/** The message that starts a new run after a person declined a booking. */
export const declineMessage = (reason: string) => `The booking was declined: ${reason.trim().replace(/[.\s]+$/, '')}. Propose a new booking.`;
