// The network map. It measures its panel and lays the stations out in real pixels,
// so it always fills the panel and every label renders at its CSS size (at least 16px) at 1600x900 and 1280x720.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DOMAINS, LABEL, type Mode, type NetState } from './network';

/**
 * The person who approves bookings. It belongs to the run that proposed the booking: it shows pending, then approved or declined,
 * fades when the next run starts (old: true) and is gone after Reset (no approval left).
 */
export type PersonState = { status: 'pending' | 'approved' | 'declined' | 'invalidated'; by: string; old: boolean } | null;

const COLOR = { a2a: 'var(--a2a)', delegation: 'var(--ink)', local: 'var(--ink)', tool: 'var(--mcp)', board: 'var(--zone-edge)' } as const;
type Pt = [number, number];

/** re-render every 400ms so "recent" highlights fade out */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Station sizes from the label: Overpass 800 is about 0.6em wide per character. */
const FONT = 19;
const pillW = (label: string, font = FONT) => Math.round(label.length * font * 0.62 + 40);
const PILL_H = 48;

function layout(w: number, h: number, mode: Mode) {
  const cx = w / 2;
  const cy = h / 2 + (mode === 'decentralized' ? 24 : 0);
  // the ring keeps half a station plus a margin (and room for the passport tag and the tool name) from every edge
  const rx = Math.max(120, w / 2 - pillW('Accessibility') / 2 - 20);
  const ry = Math.max(110, h / 2 - PILL_H / 2 - 50 - (mode === 'decentralized' ? 24 : 0));
  const pos: Record<string, Pt> = {};
  DOMAINS.forEach((d, k) => {
    const a = ((-90 + (360 / DOMAINS.length) * k) * Math.PI) / 180;
    pos[d] = [Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))];
  });
  pos.triage = pos.single = pos.board = [cx, cy];
  return { pos, cx, cy };
}

export function NetworkMap({ mode, net, seenBy, entry = 'program', person = null, picked, onPick }: { mode: Mode; net: NetState; seenBy: string[]; entry?: string; person?: PersonState; picked?: string | null; onPick?: (id: string) => void }) {
  const now = useNow();
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const center = mode === 'single' ? 'single' : mode === 'centralized' ? 'triage' : 'board';
  const recent = (t?: number, ms = 2500) => !!t && now - t < ms;
  const { pos, cx, cy } = layout(w, h, mode);
  const curve = (a: Pt, b: Pt, bend = 0.25) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    return `M${a[0]},${a[1]} Q${mx + (cx - mx) * bend},${my + (cy - my) * bend} ${b[0]},${b[1]}`;
  };

  return (
    <div className="netmap-box" ref={ref}>
      {w > 0 && (
        <svg className="netmap" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Agent network: ${mode === 'decentralized' ? 'peer to peer with a shared board' : mode}`}>
          {/* possible routes (static, faint) */}
          {mode !== 'decentralized' && DOMAINS.map((d) => <line key={`p-${d}`} x1={cx} y1={cy} x2={pos[d][0]} y2={pos[d][1]} className="route-possible" />)}

          {/* travelled routes */}
          {Object.values(net.edges).map((e) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            const isHub = e.from === center || e.to === center;
            const d = isHub ? `M${a[0]},${a[1]} L${b[0]},${b[1]}` : curve(a, b);
            const sw = Math.min(14, 5 + e.count * 1.5);
            return (
              <g key={`${e.from}>${e.to}`}>
                <path d={d} className={`route ${e.kind}`} style={{ stroke: COLOR[e.kind], strokeWidth: sw }} />
                {e.live > 0 && <path d={d} className="route-live" style={{ stroke: COLOR[e.kind] }} />}
                {e.kind !== 'tool' && e.kind !== 'board' && e.live > 0 && (
                  <circle r="9" className="token" style={{ fill: COLOR[e.kind] }}>
                    <animateMotion dur="1.2s" repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* the centre: Planner (single), Triage (centralized) or the plan board (peer to peer) */}
          {mode === 'decentralized' ? (
            <g className={`board ${net.board.length ? 'filled' : ''}`}>
              <rect x={cx - 92} y={cy - 40} width="184" height="80" rx="12" />
              <text x={cx} y={cy - 2} textAnchor="middle" className="board-title">
                Plan board
              </text>
              <text x={cx} y={cy + 24} textAnchor="middle" className="board-sub">
                {net.board.length} {net.board.length === 1 ? 'post' : 'posts'}, no agent
              </text>
            </g>
          ) : (
            <Station id={center} at={pos[center]} hub net={net} recent={recent} saw={seenBy.includes(center)} />
          )}

          {/* domain stations: data the single agent reaches into, or agents in the networks */}
          {DOMAINS.map((d) => (
            <Station key={d} id={d} at={pos[d]} data={mode === 'single'} net={net} recent={recent} saw={seenBy.includes(d)} entry={mode === 'decentralized' && d === entry} picked={picked === d} onPick={mode === 'single' ? undefined : onPick} />
          ))}

          {/* a person decides: bookings wait for approval, outside the agents */}
          {/* single: below the Planner, in the gap between Catering and Budget; networks: the free corner next to Travel. No other line crosses it. */}
          {person && pos[person.by] && (
            <Person
              at={person.by === 'single' || person.by === 'triage' ? [cx, Math.round(cy + Math.min(150, (pos.catering[1] - cy) * 0.9))] : [Math.round(pillW('A person decides', 18) / 2 + 16), 44]}
              from={pos[person.by]}
              status={person.status}
              old={person.old}
            />
          )}
        </svg>
      )}
    </div>
  );
}

function Station({ id, at, hub, data, entry, net, recent, saw, picked, onPick }: { id: string; at: Pt; hub?: boolean; data?: boolean; entry?: boolean; net: NetState; recent: (t?: number, ms?: number) => boolean; saw: boolean; picked?: boolean; onPick?: (id: string) => void }) {
  const n = net.nodes[id];
  const busy = (n?.busy ?? 0) > 0;
  const spoke = !!n?.spoke || (!!data && !!n);
  const label = LABEL[id];
  const font = hub ? 22 : FONT;
  const pw = hub ? Math.max(pillW(label, font), 168) : pillW(label);
  const ph = hub ? 64 : PILL_H;
  const [x, y] = at;
  const tools = Object.keys(n?.tools ?? {});
  const lastTool = recent(n?.lastAt) ? n?.lastTool : undefined;
  const below = y + ph / 2;
  return (
    <g
      className={`station d-${id} ${busy ? 'busy' : ''} ${data ? 'data' : ''} ${spoke ? 'spoke' : ''} ${hub ? 'hub' : ''} ${entry ? 'entry' : ''} ${onPick ? 'pickable' : ''} ${picked ? 'picked' : ''}`}
      {...(onPick ? { role: 'button', tabIndex: 0, 'aria-label': `${label}: show its A2A agent card`, onClick: () => onPick(id), onKeyDown: (e: any) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(id)) } : {})}
    >
      {busy && <rect x={x - pw / 2 - 8} y={y - ph / 2 - 8} width={pw + 16} height={ph + 16} rx={(ph + 16) / 2} className="halo" />}
      {entry && <rect x={x - pw / 2 - 7} y={y - ph / 2 - 7} width={pw + 14} height={ph + 14} rx={(ph + 14) / 2} className="entry-ring" />}
      <rect x={x - pw / 2} y={y - ph / 2} width={pw} height={ph} rx={data ? 10 : ph / 2} className="node" />
      <text x={x} y={y + font * 0.36} textAnchor="middle" className="node-label" style={{ fontSize: font }}>
        {label}
      </text>
      {/* tool ticks: one per distinct tool, in a row above the station */}
      {!hub &&
        tools.map((t, k) => (
          <rect key={t} x={x - (tools.length * 18) / 2 + k * 18 + 2} y={y - ph / 2 - 20} width="14" height="14" rx="3" className={`tick ${t === lastTool ? 'fresh' : ''}`}>
            <title>{`${t}, ${n!.tools[t]} calls`}</title>
          </rect>
        ))}
      {entry && (
        <g className="entry-tag">
          <rect x={x - 96} y={y - ph / 2 - 58} width="192" height="30" rx="15" />
          <text x={x} y={y - ph / 2 - 37} textAnchor="middle">
            Request enters here
          </text>
        </g>
      )}
      {saw ? (
        <g className="passport-tag">
          <rect x={x - 82} y={below + 6} width="164" height="28" rx="6" />
          <text x={x} y={below + 26} textAnchor="middle">
            saw passport data
          </text>
        </g>
      ) : (
        lastTool && (
          <text x={x} y={below + 24} textAnchor="middle" className="tool-flash">
            {lastTool}
          </text>
        )
      )}
    </g>
  );
}

const PERSON_SUB: Record<string, string> = { pending: 'booking waits', approved: 'approved', declined: 'declined, new run', invalidated: 'no open booking' };
function Person({ at, from, status, old }: { at: Pt; from: Pt; status: string; old: boolean }) {
  const [x, y] = at;
  const pw = pillW('A person decides', 18);
  return (
    <g className={`person ${status} ${old ? 'old' : ''}`}>
      <line x1={from[0]} y1={from[1]} x2={x} y2={y} className="person-line" />
      <rect x={x - pw / 2} y={y - 30} width={pw} height={60} rx={12} className="person-node" />
      <text x={x} y={y - 4} textAnchor="middle" className="person-label">
        A person decides
      </text>
      <text x={x} y={y + 18} textAnchor="middle" className="person-sub">
        {PERSON_SUB[status] ?? status}
      </text>
    </g>
  );
}
