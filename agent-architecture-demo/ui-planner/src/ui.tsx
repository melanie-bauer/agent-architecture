// Small shared pieces: attribution chips, change flash, cards, empty states.
import { createContext, useContext, type ReactNode } from 'react';
import { clock, type Meta } from './api';
import { LABEL, type Mode, type RequestKind } from './network';
import { ENTRY, MAIN_REQUESTS, MORE_REQUESTS, REQUEST_DOMAINS, REQUESTS } from './requests';

/** Button labels in the top bar. */
export const MODE_NAME: Record<Mode, string> = { single: 'Single agent', centralized: 'Centralized', decentralized: 'Decentralized' };
/** The name used wherever a mode is explained. */
export const MODE_TITLE: Record<Mode, string> = { single: 'Single agent', centralized: 'Centralized', decentralized: 'Peer to peer with a shared board' };
export const MODE_HINT: Record<Mode, string> = {
  single: 'One agent holds every tool.',
  centralized: 'Triage delegates to 7 specialists over A2A.',
  decentralized: '7 peers ask each other over A2A and share a board.',
};
export const DOMAIN_NAME: Record<string, string> = { ...LABEL, access: 'Accessibility' };

/** The hint for a setup, naming who works on the current request (without a request: the general hint). */
export function modeHint(mode: Mode, request?: RequestKind | null) {
  if (!request) return mode === 'centralized' ? 'Triage delegates to specialists over A2A.' : MODE_HINT[mode];
  const names = REQUEST_DOMAINS[request].map((d) => DOMAIN_NAME[d] ?? d);
  const list = names.length > 3 ? `${names.length} specialists` : names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : names.join(' and ');
  if (mode === 'centralized') return `Triage asks ${list} over A2A.`;
  if (mode === 'decentralized') return `The request enters at ${DOMAIN_NAME[ENTRY[request]]}, and the peers ask each other over A2A.`;
  return MODE_HINT.single;
}

/** "Venue (centralized)" or "Single agent". */
export const writerName = (m: Pick<Meta, 'by' | 'mode'>) => (m.by === 'single' ? 'Single agent' : `${LABEL[m.by] ?? m.by} (${m.mode})`);

/** A change is fresh for a few seconds after it lands: the item flashes in its owner's colour. */
export const FRESH_MS = 4000;
export const isFresh = (at?: number) => !!at && Date.now() - at < FRESH_MS;
export const freshClass = (m?: Pick<Meta, 'at' | 'domain'> | null) => (m && isFresh(m.at) ? ` flash d-${m.domain}` : '');

/** A previous version worth showing: written by someone else, or clearly earlier (not one step of a burst of parallel writes). */
export const realPrev = <T extends Meta>(e?: (T & { prev?: T }) | null): T | undefined =>
  e?.prev && (e.prev.by !== e.by || e.at - e.prev.at > 1000) ? e.prev : undefined;

export function Who({ m, verb = true }: { m: Meta & { prev?: unknown }; verb?: boolean }) {
  const action = m.prev ? 'Changed' : 'Added';
  return (
    <span className={`who d-${m.domain}`} title={`${action} by ${writerName(m)} at ${clock(m.at)}`}>
      <i className="stop" aria-hidden="true" />
      {verb && <span className="who-verb">{action} by </span>}
      {writerName(m)}
      {isFresh(m.at) && <span className="who-new">new</span>}
    </span>
  );
}

export function DomainTag({ domain }: { domain: string }) {
  return (
    <span className={`dtag d-${domain}`}>
      <i className="stop" aria-hidden="true" />
      {DOMAIN_NAME[domain] ?? domain}
    </span>
  );
}

export function ScreenHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="screen-head">
      <div>
        <h1>{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {actions && <div className="screen-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, children, aside, className = '', domain }: { title?: ReactNode; children: ReactNode; aside?: ReactNode; className?: string; domain?: string }) {
  return (
    <section className={`panel ${domain ? `edge d-${domain}` : ''} ${className}`}>
      {(title || aside) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {aside && <div className="panel-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Lets any screen send a request to the docked assistant, or a follow-up (after a declined booking) without clearing the plan. */
export const RunContext = createContext<{ run: (kind: RequestKind) => void; followUp: (text: string) => Promise<void>; running: boolean }>({ run: () => {}, followUp: async () => {}, running: false });
export const useRun = () => useContext(RunContext);

/** The two stage requests as buttons (the first one primary); the big requests sit under "More requests". */
export function RequestButtons({ first = 'rooms' }: { first?: RequestKind }) {
  const { run, running } = useRun();
  if (running) return null;
  const main = MAIN_REQUESTS.includes(first) ? [first, ...MAIN_REQUESTS.filter((k) => k !== first)] : MAIN_REQUESTS;
  return (
    <div className="request-buttons">
      {main.map((k, i) => (
        <button key={k} className={`btn ${i === 0 ? 'primary' : ''}`} onClick={() => run(k)} title={REQUESTS[k].text}>
          {REQUESTS[k].title}
        </button>
      ))}
      <details className="more-requests">
        <summary className="btn">More requests</summary>
        <div className="more-menu" role="menu">
          {MORE_REQUESTS.map((k) => (
            <button key={k} role="menuitem" onClick={(e) => (e.currentTarget.closest('details')?.removeAttribute('open'), run(k))}>
              <b>{REQUESTS[k].title}</b>
              <span>{REQUESTS[k].short}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

export function NotYet({ children, first }: { children: ReactNode; first?: RequestKind }) {
  return (
    <div className="not-yet">
      <p>{children}</p>
      <RequestButtons first={first} />
    </div>
  );
}

export function Search({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="search">
      <span className="sr-only">{label}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input type="search" value={value} placeholder={label} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; name: string }[]; onChange: (v: any) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? 'on' : ''} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}
