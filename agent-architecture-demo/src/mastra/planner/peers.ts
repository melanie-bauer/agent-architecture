// Peer-to-peer tools for the decentralized network ("peer to peer with a shared board"):
// talk to any other peer directly (over A2A), and a shared plan board.
import { createTool } from '@mastra/core/tools';
import { MastraClient } from '@mastra/client-js';
import { z } from 'zod';
import { redactPassports } from './passport';
import { DOMAINS } from './tools';
import { bus, emit, nodeOf, vizId } from './viz';

export const PLANNER_URL = process.env.PLANNER_URL ?? 'http://localhost:4111';
/** 'a2a' = peers call each other over HTTP using the A2A protocol (needs the server). 'local' = in-process (tests, CLI). */
export const transport = (): 'a2a' | 'local' => (process.env.PLANNER_TRANSPORT === 'local' ? 'local' : 'a2a');

// ---- guard rails for a network nobody is in charge of ----
export const MAX_DEPTH = 3; // A asks B asks C asks D, then stop
export const MAX_MESSAGES = 12; // per user request
// The board and the message budget belong to one run (one request), not to the plan: they start fresh with every run
// (the "run" event from startRun in plan-store.ts). The plan accumulates; the board is the peers' working channel for one request.
// So a budget peer that reads the board reads only what this run posted, never a venue cost of an earlier run.
// Depth is counted per chain of questions, not globally, so one peer can ask two others at the same time:
// a peer's depth is the depth of the deepest question it is answering right now (0 for the peer the user talks to).
const state = { messages: 0, serving: new Map<string, number[]>(), board: new Map<string, { agent: string; note: string }[]>() };
export function resetNetwork() {
  state.messages = 0;
  state.serving.clear();
  state.board.clear();
}
bus.on('event', (e: any) => e.type === 'reset' && (e.scope === 'all' || (e.scope === 'run' && e.mode === 'decentralized')) && resetNetwork());
const depthOf = (peer: string) => Math.max(0, ...(state.serving.get(peer) ?? []));

let localResolver: ((peerId: string) => any) | undefined;
export function setLocalResolver(fn: (peerId: string) => any) {
  localResolver = fn;
}

/** An A2A task as message/send returned it: Mastra answers with the finished task (state "completed"), no intermediate states. */
type Task = { id: string; contextId?: string; state: string };
async function callPeer(peerId: string, text: string): Promise<{ text: string; task?: Task }> {
  if (transport() === 'local') {
    const agent = localResolver?.(peerId);
    if (!agent) throw new Error(`unknown peer ${peerId}`);
    const r = await agent.generate(text);
    return { text: r.text };
  }
  // A2A: discover the peer by its agent card, then send a message (JSON-RPC message/send)
  // no retries: a retried message would start the same work a second time
  const a2a = new MastraClient({ baseUrl: PLANNER_URL, retries: 0 }).getA2A(peerId);
  const res: any = await a2a.sendMessage({
    message: { kind: 'message', role: 'user', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text }] },
  } as any);
  const result = res?.result ?? res;
  const parts = result?.artifacts?.flatMap((a: any) => a.parts) ?? result?.status?.message?.parts ?? result?.parts ?? [];
  const reply = parts.filter((p: any) => p.kind === 'text').map((p: any) => p.text).join('\n');
  const task = result?.kind === 'task' || result?.status?.state ? { id: String(result.id), contextId: result.contextId, state: String(result.status?.state ?? 'unknown') } : undefined;
  return { text: reply || JSON.stringify(result).slice(0, 500), task };
}

export function peerTools(self: string) {
  const me = nodeOf(self)!;
  const others = DOMAINS.filter((d) => d !== me);
  return {
    askPeer: createTool({
      id: 'askPeer',
      description: `Ask another specialist directly. Peers: ${others.join(', ')}. Use it when your part depends on their domain. Keep requests short and concrete. When you need several peers and their work does not depend on each other, ask them in the same step: the questions then run at the same time.`,
      inputSchema: z.object({ peer: z.enum(others as [string, ...string[]]), request: z.string() }),
      execute: async ({ peer, request }: { peer: string; request: string }) => {
        const depth = depthOf(me) + 1;
        if (depth > MAX_DEPTH) return { refused: `Max conversation depth (${MAX_DEPTH}) reached. Answer with what you know.` };
        if (state.messages >= MAX_MESSAGES) return { refused: `Message budget (${MAX_MESSAGES}) for this request used up. Answer with what you know.` };
        state.messages++;
        const id = vizId();
        const ask = redactPassports(request).text;
        emit({ type: 'message', mode: 'decentralized', from: me, to: peer, text: ask, via: transport(), id });
        const list = state.serving.get(peer) ?? [];
        list.push(depth);
        state.serving.set(peer, list);
        const t0 = Date.now();
        try {
          // what leaves a peer is redacted: passport numbers stay with Travel
          const answer = await callPeer(`peer-${peer}`, `[from ${me}] ${ask}`);
          const { text: reply, count } = redactPassports(answer.text);
          emit({ type: 'reply', mode: 'decentralized', from: peer, to: me, text: reply, id, ms: Date.now() - t0, ...(count ? { redacted: count } : {}), ...(answer.task ? { task: answer.task } : {}) });
          return { from: peer, reply };
        } finally {
          list.splice(list.indexOf(depth), 1);
        }
      },
    }),
    postToBoard: createTool({
      id: 'postToBoard',
      description: 'Post your result to the shared plan board that every peer can read.',
      inputSchema: z.object({ section: z.string(), note: z.string() }),
      execute: async ({ section, note }: { section: string; note: string }) => {
        const clean = redactPassports(note).text;
        const list = state.board.get(section) ?? [];
        list.push({ agent: me, note: clean });
        state.board.set(section, list);
        emit({ type: 'board', mode: 'decentralized', agent: me, section, note: clean });
        return { posted: true };
      },
    }),
    readBoard: createTool({
      id: 'readBoard',
      description: 'Read the shared plan board.',
      inputSchema: z.object({}),
      execute: async () => {
        const id = vizId();
        emit({ type: 'tool', mode: 'decentralized', agent: me, tool: 'readBoard', args: {}, id });
        // a copy: the board as it is at this moment (later posts must not show up in this read)
        const board = Object.fromEntries([...state.board].map(([k, l]) => [k, l.map((x) => ({ ...x }))]));
        const posts = [...state.board.values()].reduce((s, l) => s + l.length, 0);
        emit({ type: 'tool-result', mode: 'decentralized', agent: me, tool: 'readBoard', id, summary: `${posts} posts`, result: board, ms: 0 });
        return board;
      },
    }),
  };
}
