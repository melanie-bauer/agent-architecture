// Plain English sentences for the activity log, built from the tool name, its arguments and its result.
// "Venue assigned Hall A to the keynote and the Agents track."
import { checkSum } from './api';
import { LABEL, type Entry } from './network';

const who = (id?: string) => (id ? (LABEL[id] ?? id) : 'Someone');
const eur = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `€${Math.round(n).toLocaleString('en-US')}` : null);
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Results arrive as JSON; some come wrapped once more. */
function value(v: unknown): any {
  if (v && typeof v === 'object' && 'truncated' in (v as any)) return {};
  return v ?? {};
}

function uses(r: any) {
  const u = [r.keynote && 'the keynote', r.track && `the ${r.track} track`, r.overflow && 'the keynote overflow'].filter(Boolean) as string[];
  return u.length ? `${r.room} to ${list(u)}` : `${r.room} with no use`;
}

/** The sentence for one entry. While a call is running the sentence says what the agent is doing. */
export function sentence(e: Entry): string {
  const a = who(e.agent);
  const args: any = e.args ?? {};
  const r: any = value(e.result);
  const done = !e.pending;
  switch (e.kind) {
    case 'message':
      return e.agent === 'router' ? `${a} sent the request to ${who(e.to)}` : `${a} asked ${who(e.to)}`;
    case 'board':
      return `${a} posted ${args.section ? `“${args.section}” ` : ''}to the plan board`;
  }
  switch (e.tool) {
    // ---- program ----
    case 'listSubmissions':
      return done ? `${a} read ${plural(arr(r).length, 'submission')}` : `${a} is reading the submissions`;
    case 'shortlistTalks':
      return `${a} shortlisted the ${args.slotsPerTrack ?? 10} best rated talks per track`;
    case 'draftSchedule':
      return `${a} drafted the schedule with the keynotes in ${args.keynoteRoom ?? 'the keynote room'}`;
    case 'placeTalks': {
      const tracks = arr(args.tracks).map((t: any) => t.track);
      const placed = arr(r).reduce((s: number, x: any) => s + (Number(x.placed) || 0), 0);
      return done ? `${a} scheduled ${plural(placed, 'talk')} in ${list(tracks)}` : `${a} is scheduling talks in ${list(tracks)}`;
    }
    // ---- venue ----
    case 'listRooms':
      return `${a} looked up the rooms`;
    case 'checkAvailability':
      return `${a} checked when ${list(arr(args.rooms))} are free`;
    case 'quoteVenue':
      return done && eur(r.totalEur) ? `${a} priced ${list(arr(args.rooms))}: ${eur(r.totalEur)} with AV` : `${a} is pricing ${list(arr(args.rooms))}`;
    case 'assignRooms':
      return `${a} assigned ${list(arr(args.rooms).map(uses))}`;
    case 'dropRoom':
      return `${a} dropped ${args.room}${args.reason ? `: ${args.reason}` : ''}`;
    // ---- access ----
    case 'checkRoomAccess': {
      const bad = arr(r).filter((x: any) => x.stepFree === false).map((x: any) => x.room);
      return done ? `${a} checked access for ${plural(arr(args.rooms).length, 'room')}${bad.length ? `: ${list(bad)} not step-free` : ', all step-free'}` : `${a} is checking room access`;
    }
    case 'quoteCaptioning':
      return done && eur(r.totalEur) ? `${a} priced live captions in ${list(arr(args.rooms))}: ${eur(r.totalEur)}` : `${a} is pricing live captions`;
    case 'markRooms': {
      const rooms = arr(args.rooms);
      const bad = rooms.filter((x: any) => !x.stepFree).map((x: any) => x.room);
      return `${a} recorded access for ${list(rooms.map((x: any) => x.room))}${bad.length ? `. Not step-free: ${list(bad)}` : ''}`;
    }
    case 'bookCaptions':
      return `${a} booked live captions in ${list(arr(args.rooms))}${eur(r.totalEur) ? ` for ${eur(r.totalEur)}` : ''}`;
    // ---- catering ----
    case 'listCaterers':
      return `${a} looked up the caterers`;
    case 'dietaryStats':
      return `${a} read the dietary needs`;
    case 'quoteCatering':
      return done && eur(r.totalEur) ? `${a} got a quote from ${args.caterer} for ${args.headcount} people: ${eur(r.totalEur)}` : `${a} is asking ${args.caterer} for a quote`;
    case 'chooseCaterer':
      return `${a} chose ${args.caterer} for ${args.headcount} people${eur(r.totalEur) ? `, ${eur(r.totalEur)}` : ''}`;
    // ---- travel ----
    case 'listInternationalSpeakers':
      return `${a} listed the speakers who fly in${args.country ? ` from ${args.country}` : ''}`;
    case 'quoteTravel':
      return done && eur(r.totalEur) ? `${a} priced travel at list prices: ${eur(r.totalEur)}` : `${a} is pricing travel`;
    case 'bookTravel':
    case 'bookFlights':
    case 'bookHotel':
      return done
        ? r.status === 'waiting for approval'
          ? `${a} proposed a booking for ${plural(Number(r.speakers) || 0, 'speaker')}, ${eur(r.totalEur)}. It waits for a person`
          : `${a} could not propose the booking`
        : `${a} is proposing a booking`;
    case 'lastProposal':
      return done ? `${a} read the last proposal${r.declineReason ? `: declined, "${r.declineReason}"` : ''}` : `${a} is reading the last proposal`;
    case 'readPassports':
      return done ? `${a} read ${plural(arr(r.passports).length, 'passport')} from the passport registry` : `${a} is reading passports from the passport registry`;
    case 'recordVisaChecks': {
      const checks = arr(args.checks);
      const open = checks.filter((c: any) => c.status !== 'visa-free').length;
      return `${a} recorded the visa status of ${plural(checks.length, 'speaker')}${open ? `, ${open} need action` : ''}`;
    }
    case 'quoteFlights':
      return done ? `${a} got ${plural(arr(r.offers).length, 'flight offer')} from SkyQuote` : `${a} is waiting for flight offers from SkyQuote`;
    case 'quoteHotel':
      return done ? `${a} got ${plural(arr(r.offers).length, 'hotel offer')} from RheinRooms for ${plural(Number(r.guests) || 0, 'guest')}` : `${a} is waiting for hotel offers from RheinRooms`;
    // ---- budget ----
    case 'getBudget':
      return `${a} read the budget ledger`;
    case 'checkPlan':
      return done && eur(r.totalEur) ? `${a} checked ${plural(arr(args.items).length, 'cost')}: ${eur(r.totalEur)} of ${eur(r.budgetEur)}` : `${a} is checking costs against the budget`;
    case 'recordBudgetCheck':
      return `${a} recorded the budget check${eur(r.totalEur) ? `: ${checkSum({ lines: arr(args.lines), totalEur: r.totalEur, budgetEur: r.budgetEur, bufferEur: r.bufferEur })}` : ''}`;
    // ---- marketing ----
    case 'ticketForecast':
      return `${a} read the ticket forecast`;
    case 'sponsorPipeline':
      return `${a} read the sponsor pipeline`;
    // ---- every domain ----
    case 'flagRisk':
      return r.refused ? `${a} tried to flag one more risk and was refused` : `${a} flagged a risk: ${args.text ?? ''}`;
    case 'readBoard':
      return `${a} read the plan board`;
  }
  return `${a} used ${e.tool}`;
}

/** The answer line under a message. */
export function replyLine(e: Entry) {
  if (e.kind !== 'message' || e.agent === 'router') return '';
  if (e.pending) return `Waiting for ${who(e.to)}`;
  return `${who(e.to)} answered${e.ms ? ` after ${(e.ms / 1000).toFixed(1)} s` : ''}`;
}
