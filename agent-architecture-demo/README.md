# Demos: Incident Desk + Planner network

Demo code for **"Agents Don't Need More Tools. They Need Architecture."** (Melanie Bauer). Two examples in one Mastra server:

- **Example 1 · Incident Desk** (`src/mastra/incident-desk/`, UI in `ui-incident-desk/`): boundaries around a supervisor.
- **Example 2 · Planner network** (`src/mastra/planner/`, UI in `ui-planner/`): the same request as single agent, centralized and decentralized network, with a live map of who is working and a plan the agents write (section "Planner network").

## Example 1 · Incident Desk

One fictional incident (Parcelly, ticket `INC-4711`: checkout returns 502 since 14:05), one architecture: a supervisor with two read-only specialists, a delegation hook that redacts customer data, and a human approval before anything changes. It runs in two ways:

| Way | Agent | Where | Who executes the change |
|---|---|---|---|
| Chat | `incidentCommander` | Desk UI, tab Chat (AG-UI) | the agent calls the tool, each write waits for a human (`requireApproval`) |
| Workflow | `incidentInvestigator` inside `incidentTriage` | Desk UI, tab Workflow, and Studio | code decides the path; the agent only proposes; after the human approves, plain code executes against an allow list |

Stack: Mastra `@mastra/core` 1.81 · AG-UI 1.0 (`@ag-ui/mastra` 2.0) · OpenAI via `@ai-sdk/openai` · Node ≥ 22.13.

## Setup

```bash
npm install
cp .env.example .env        # add OPENAI_API_KEY for live mode
npm test                    # architecture tests, offline, about 30 s
npm run build:planner       # only after editing ui-planner/ (the built UI is included)
```

Without a key everything runs in **mock mode**: a scripted model replays plausible runs. Mock mode proves the wiring (who can do what, who sees what), not model behaviour. The server log (`[demo] DEMO_MODE=… PLANNER_MODE=…`) and the badges in both UIs show the active mode.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Mastra Studio + API + AG-UI endpoint on http://localhost:4111 |
| `npm run dev:mock` | same, forced offline (both examples scripted) |
| `npm run dev:planner-mock` | Incident Desk as configured, planner scripted (`PLANNER_MODE=mock`) |
| http://localhost:4111/planner | Planner UI (plan screens, docked assistant, network screen) |
| http://localhost:4111/desk | Incident Desk UI with three tabs: Chat (`#chat`), Workflow (`#workflow`), Visualization (`#viz`) |
| `npm test` | Demo 4: architecture tests (mock model, deterministic) |
| `npm run probe:live` | behavioural checks against the real model (`-- --runs=5` for pass rates → `recordings/probe-live.json`) |
| `npm run smoke` | quick workflow run in the terminal |
| `npx tsx scripts/http-workflow-check.ts` | start + resume the workflow over HTTP (needs `npm run dev`) |
| `npm run build:ui` | rebuild `ui-incident-desk/agui-client.js` after editing `ui-incident-desk/src/client.ts` |
| `npm run build:planner` | rebuild `ui-planner/dist` after editing `ui-planner/src` |
| `npm run planner:smoke` | runs the planner request in all three modes in the terminal |

## Where to look

```
src/mastra/
  index.ts                 entry point (`mastra dev` expects it here): registers both examples, storage, routes
  storage.ts               persistence: LibSQL file (threads, messages, paused workflows) + DuckDB file (traces)
  model/                   shared: live or mock model per agent, mock model, recorder (tokens, PII check)
  incident-desk/           Example 1
    data/incident-data.ts      fake external systems: tickets, logs (incl. a prompt-injection line), deploys, metrics
    tools/index.ts             8 tools in 3 risk tiers; every tool that is not read-only gets requireApproval
    agents/specialists.ts      triage, logAnalyst, deployHistorian (contracts in `description`)
    agents/supervisors.ts      incidentInvestigator (no write tools) + incidentCommander (gated tools)
    agents/delegation.ts       messageFilter / onDelegationStart (budget per run) / onDelegationComplete, fail closed
    workflows/incident-triage.ts   load, classify, branch, investigate, approve (suspend), execute
    server/agui-route.ts       POST /agui/:agentId, AG-UI event stream (MastraAgent + EventEncoder) plus one CUSTOM event per specialist request
    server/desk-tap.ts         observes what a specialist's model really received (after redaction), for the UI only
    server/workflow-route.ts   POST /desk/workflow: starts or resumes incidentTriage and streams it as AG-UI events
    server/roster.ts           who holds which tools, read from the agents, served by /desk/info
    routes.ts                  /desk, /desk/info, /desk/agui-client.js, /desk/fonts, /agui, /desk/workflow
    scorers.ts                 evidenceGrounded (deterministic scorer)
    mock-scripts.ts            scripted behaviour per agent for mock mode
  planner/                 Example 2 (see below)
ui-incident-desk/          Incident Desk browser UI: index.html, src/ (client.ts chat, workflow.ts, viz.ts, tabs.ts, shared.ts), PRODUCT.md, DESIGN.md, screenshots/
ui-planner/                planner React app (src = source, dist = built)
test/architecture.test.ts  fitness functions for the architecture
scripts/                   wsl-setup, live-probe, smoke, http check, planner smoke and measure
```

### Desk screen

http://localhost:4111/desk has three tabs. The tab is in the URL (`/desk#chat`, `/desk#workflow`, `/desk#viz`), so each can be opened directly. On screens narrower than 1200 px (for example 1280 px at 150 % zoom) the AG-UI panel opens from the "AG-UI events" button. For the Visualization tab use 100 % zoom on a 1280x720 projector.

**Chat** (the commander). Left: the three demo steps as stations on a line, and "Who can do what" (each agent's tools, read from the agents). Middle: the conversation. Right: the AG-UI events as a timeline grouped by run and agent; "Raw events" shows the JSON. The badge says "Mock model, scripted" or "Live model"; token numbers say "estimated (mock)" or "measured (live)".

| Step | Sends | What appears | Proof on screen |
|---|---|---|---|
| 1 Investigate | ticket INC-4711 with name, email and card | one card per delegation: "Commander sent" next to "logAnalyst received", customer data marked red on the left, `[email]` green on the right, and the tools the specialist was offered | "logAnalyst and deployHistorian never saw the customer's name, email or card." |
| 2 Mitigate | "Mitigate it." | the approval card: "Roll back checkout to v2.40.3", arguments, "The run has ended ... Nothing is running." Decline with a reason, run the step again, approve. In mock a second card asks to publish a status update (irreversible). | "The run has ended. Nothing is running. Your approval waits as state in the thread." then "You declined 1 request, then approved ..." |
| 3 Follow-up | "What must happen before we re-deploy SDK 7.0?" | a new run in the same thread; in mock the commander asks deployHistorian once more | "Answered in the same thread, on top of N earlier runs." |

**Workflow** (`incidentTriage`, the same workflow Studio shows). Left: two tickets to run and "Who decides where". Middle: the workflow as a line of stations; the shape says who decides (square code, circle model, diamond person). Right: the same AG-UI timeline and raw events as in the chat. The server translates Mastra's workflow stream into AG-UI events (`STEP_STARTED`/`STEP_FINISHED`, `CUSTOM` for the ticket, step results and delegations, `RUN_FINISHED` with an interrupt while the approval waits).

| Ticket | What appears | Proof on screen |
|---|---|---|
| Run INC-4711 | load-ticket shows the ticket as it arrived (customer data red) next to the text after load-ticket (placeholders green); classify shows sev1; branch shows both conditions and the one taken; investigate shows each delegation and the structured findings; approve-remediation shows the approval card | "The workflow is paused. Its snapshot is stored in the database, and nothing is running." Approve: execute-remediation rolls back to v2.40.3 after the allow-list check. Decline with a reason: "Not executed ... Escalated to on-call." |
| Run INC-4712 | classify says sev3, the branch files a backlog item, investigate, approve and execute show "Skipped by the branch" | the AG-UI timeline shows one small model call and no delegation |

**Visualization**: a scripted walkthrough, no server and no model. A ticket moves along a transit-map picture of the architecture; the panel on the right says who decides at each station and why. Four scenarios: outage approved, typo (sev3), prompt injection in a log line, outage declined. Next and Back, arrow keys, space, or a presenter clicker (Page Down / Page Up).

What a specialist received is not recomputed in the browser: the model wrapper reports each specialist model call (`server/desk-tap.ts`), and the AG-UI route sends it as a `CUSTOM` event `desk.specialistInput`. The mock commander judges each user message on its own, so the flow works in one thread. Screens: `ui-incident-desk/screenshots/` (mock).

### Persistence

There is no hand-written persistence layer because the examples don't own business data. What has to survive is stored by Mastra's own storage layer, configured in `storage.ts`:

- `incident-desk.db` (LibSQL, a SQLite file): conversation threads and messages, and workflow snapshots. A workflow waiting for an approval is stored here, so it survives a restart and nothing waits in memory.
- `traces.duckdb` (DuckDB): traces and metrics for Mastra Studio.

Tickets, logs, deploys, rooms and budgets are fixed fake data in the `data` files. They stand in for external systems (ticket system, log store, deploy history, venue catalogue). The tools are the adapters to those systems: in a real project a tool would call a service or repository instead of reading the fake data, and the agents would not change. Both database files are created on start and can be deleted at any time.

## Example 2 · Planner network

VibeKode 2027 (fictional AI developer conference in Mainz): 600 attendees, 2 days, 3 tracks (Agents, AI Engineering, AI in Practice), €180,000. Seven domains with their own data and tools: program, venue, catering, travel, budget, marketing, accessibility. The constraints collide on purpose: Room C is not step-free, the keynote hall is too small for 600, and travel is only known after the speakers are booked.

The UI looks like ordinary event-planning software. The agents write the plan; the screens show it, with "who wrote this, in which mode, when" on every entry.

| Mode (switch in the top bar) | Agent | What it shows |
|---|---|---|
| Single agent | `planner-single` | one agent, all 33 tools (21 read, 12 write), one context |
| Centralized | `planner-triage` → `spec-*` | triage hub without tools; 7 specialists called as **A2A agents** (`A2AAgent`, agent cards at `/api/.well-known/spec-<domain>/agent-card.json`); delegation hooks report every message. The hub has to pass on Accessibility's finding to Venue, which then drops Room C. |
| Decentralized ("peer to peer with a shared board") | `peer-<entry>` → `peer-*` | the request enters at the peer it needs (rooms at Venue, travelUs at Travel, the big requests at Program); 7 peers with `askPeer` (A2A via `/api/a2a/peer-<domain>`) and a shared plan board (`postToBoard` / `readBoard`); budgets: depth ≤ 3, ≤ 12 messages per request. Budget checks before Travel has booked, so its check goes stale. |

### Plan store and write tools

`planner/plan-store.ts` holds one plan per mode in memory: talk slots, room assignments, access findings, captions, caterer, travel bookings, cost lines, the budget check and risks. Every entry carries `by` (agent), `mode` and `at`, keeps its previous version, and every change is emitted as a `plan` event on the viz bus.

The write tools each belong to one domain. A specialist or peer gets only its own domain's write tools (tested); the single agent gets all of them.

| Domain | Write tools |
|---|---|
| program | `placeTalks` |
| venue | `assignRooms` (a list), `dropRoom` (both update the venue cost line) |
| access | `markRooms` (a list, Foyer included), `bookCaptions` |
| catering | `chooseCaterer` |
| travel | `recordVisaChecks`; `bookTravel`, `bookFlights`, `bookHotel` only propose (see Approval) |
| budget | `recordBudgetCheck` (stores the values it checked) |
| every domain | `flagRisk` (bound to the owner's domain) |

A budget check is **stale** when the values it checked differ from the cost lines as they are now (travel that waits for approval counts with its proposed total). Nothing is hard-coded: in the decentralized rooms run Budget reads the board while Room C is still in it and records venue €44,200; Venue then drops Room C (€38,600), and the Budget screen shows the difference. `recordBudgetCheck` returns the values it used in words (`"checked": "venue €44,200"`), so the tool span in Studio > Traces shows them.

### Approval: a person decides

`bookTravel`, `bookFlights` and `bookHotel` never write a booking. They store a **pending approval** in the plan store with the exact arguments (speakers, flight offers, hotel, nights, amounts, total, requesting agent, setup) and a hash of the arguments, return "waiting for approval", and the run ends. The UI draws the card from the plan (assistant dock and Travel screen; no generative UI): arguments, evidence (quotes, visa status), **Approve**, **Decline** with a required reason.

- `POST /planner/approvals/:id/approve`: the server checks the hash and books exactly the stored arguments in code (SkyQuote and RheinRooms in parallel), no model call; records who approved and when. Arguments in the request body are ignored.
- `POST /planner/approvals/:id/decline` `{reason}`: stores the reason; the UI then sends "The booking was declined: <reason>. Propose a new booking." to the same setup. Travel reads the decision with `lastProposal` and proposes again.
- A newer proposal or a reset invalidates open approvals. The network map shows an amber "A person decides" node.

Every run carries `requestKind`, `setup` and `agent` as trace metadata.

Mock mode, big conference request: venue €38,600, catering €69,600, travel €18,050 (after approval), captions €3,800, total €142,050 (decentralized check: €144,000 with the travel estimate).

### Demo requests

The two stage requests are the main buttons (Overview and assistant). The big ones stay under **More requests**. Each request names its domains: the triage only holds those specialists (`agents` is chosen per request in code), and agents get the brief of that request only.

| Button | Domains | Mock result |
|---|---|---|
| **Assign rooms** (`rooms`) | venue, access, budget | Venue first puts Agents in Room C (€44,200), Accessibility marks Room C not step-free, Venue drops it and Agents goes to Hall A (€38,600), Budget checks. Centralized: the triage relays the finding. Decentralized: enters at Venue; Budget checks €44,200 before the drop (stale). |
| **Book US speakers** (`travelUs`) | travel, budget | Marcus Reed, Dana Whitfield, Kevin Brooks, Rachel Kim. One batched call per system (passports, SkyQuote, RheinRooms; 1.5 to 4 s each). Card: flights 4 x €1,100 = €4,400, hotel 4 x 3 nights x €200 = €2,400, total €6,800; after a decline with a reason 2 nights, €6,000. Only Travel (or the single agent) sees passport data. |
| More: **Plan the conference** | all seven | rooms, schedule, catering, travel (as a proposal), budget, risks |
| More: **Book speaker travel** | travel, program, budget | 14 speakers, passports, one booking proposal, schedule, budget |

### Speed

Planner agents run with `reasoningEffort: low` by default (`PLANNER_REASONING_EFFORT=none|minimal|low|medium|high|default`). Specialists and peers run on the small model and answer in at most 3 sentences, the triage and the single agent in at most 5, no tables. Write tools take lists, outside systems take batches, peers can ask several peers in the same step, and `maxSteps` depends on the request.

`npm run planner:measure` runs the stage set (rooms and travelUs in all three setups) against the running server, live or mock, and prints a table: wall time, time to the approval card, model calls on the critical path and in total, tokens, agent messages, plan, target. Options: `--request=rooms|travelUs|conference|travel`, `--mode=single|centralized|decentralized`.

Stage requests, live, 17 Nov 2026 (gpt-6.1-sol / gpt-6-luna, effort low, one run each on one machine, not a benchmark). travelUs is measured until the approval card:

| Request | Setup | Wall | Card | Calls on the critical path / total | Tokens | Agent messages | Target |
|---|---|---|---|---|---|---|---|
| rooms | single | 27.7 s | | 4 / 4 | 11,321 | 0 | 25 s, missed by 2.7 s |
| rooms | centralized | 35.4 s | | 11 / 13 | 16,154 | 3 | 60 s |
| rooms | decentralized | 23.6 s | | 11 / 16 | 17,121 | 2 | 50 s |
| travelUs | single | 18.3 s | 14.0 s | 4 / 4 | 11,727 | 0 | 45 s |
| travelUs | centralized | 33.0 s | 14.9 s | 11 / 11 | 16,149 | 2 | 45 s |
| travelUs | decentralized | 30.7 s | 10.7 s | 10 / 11 | 21,061 | 1 | 45 s |

In this live decentralized rooms run the stale read did not happen (the budget check matched the final venue cost); the mock run shows it. The single agent missed its target because its four calls on the large model took 27 s of model time.
 Live timings are stored in `recordings/planner-timings.json` (one run each, on one machine, not a benchmark). First run of request 1, before the other speed changes:

| | Default effort | Effort low |
|---|---|---|
| Single | 42 s, 5 LLM calls | 37 s, 6 LLM calls |
| Centralized | 199 s, 57 LLM calls | 164 s, 70 LLM calls |
| Decentralized | 73 s, 19 LLM calls, plan 4 of 7 | 94 s, 38 LLM calls, plan 7 of 7 |

The server timeout for a request is 15 minutes and the client does not retry, so a slow run is never started twice.

### Screens

Overview (budget bar, key figures, rooms, schedule, risks, latest changes), Program, Speakers, Rooms, Catering, Travel, Budget and Network. The assistant (CopilotKit chat) is docked on the right and folds away; it also folds away by itself on the Network screen so the map gets the width. When an agent writes something, the item lights up in the agent's colour for a few seconds and shows "Added by Venue (centralized)".

The Network screen is a visualisation of the server-side event bus (`planner/viz.ts`): agent start/end, tool calls (write calls are marked "writes the plan"), messages, board writes. It is a **trace**, not the protocol: over real A2A the caller only sees tasks and results. *Compare runs* keeps the counters of each finished run (one run each, not a benchmark; in mock mode time is simulated latency and tokens are estimates).

Every viz event carries its mode, and each mode keeps its own chat, map, activity log, counters and screen. Switching modes changes nothing; a run keeps going in the background. Reset (top bar) clears all plans, chats, maps and counters. Sending a request clears only the plan of the current mode.

The activity log reads as sentences ("Venue assigned Hall A to the Agents track"), grouped by agent step, and each entry opens to show the full arguments and result. "Agent messages" counts messages between agents, so it is always 0 for the single agent. Compare runs leads with time, LLM calls, tokens, agent messages and plan completeness.

```
src/mastra/planner/
  data.ts          fictional conference data (submissions, speakers, rooms, caterers, ledger …)
  tools.ts         20 read tools + 12 write tools per domain, each emits viz events
  plan-store.ts    the plan the agents write: one per mode, attributed, versioned, stale-check detection
  agents.ts        single agent, specialists + triage (A2A or in-process), peers
  peers.ts         askPeer over A2A (MastraClient) or in-process, depth/message budgets, plan board
  mock-scripts.ts  scripted behaviour for mock mode; answers and plan entries come from tool results
  routes.ts        /copilotkit (AG-UI), /planner UI, /planner/events (SSE), /planner/reset, /planner/info,
                   /planner/plan, /planner/data/:kind
  viz.ts           event bus + agent-id → node mapping
ui-planner/        React + CopilotKit app (PRODUCT.md and DESIGN.md describe it)
```

HTTP for the UI (read-only):

- `GET /planner/plan?mode=single|centralized|decentralized`: the plan of one mode (without `mode`: all three)
- `GET /planner/data/{event|submissions|speakers|rooms|caterers|dietary|budget|tickets|sponsors|schedule|travel|captioning}`: base data
- `POST /planner/reset` with `{"scope":"all"}` (default), `{"scope":"run","mode":"…"}` or `{"scope":"network"}`

Environment: `PLANNER_MODE=live|mock` (defaults to `DEMO_MODE`), `PLANNER_TRANSPORT=a2a|local` (default `a2a`), `PLANNER_URL` (default `http://localhost:4111`, used by the A2A clients). With Docker: `PLANNER_MODE=mock docker compose up --build` scripts only the planner.

## Docker (Windows without WSL setup)

Needs Docker Desktop. In the demo folder:

```bash
docker compose up --build
```

The first build takes a few minutes, and the server needs about a minute to bundle before it answers. Then open:

- http://localhost:4111/planner (planner, UI included)
- http://localhost:4111/desk (Incident Desk)
- http://localhost:4111 (Mastra Studio)

Without a `.env` file everything runs with the scripted mock model. For live mode create `.env` next to `docker-compose.yml` with `OPENAI_API_KEY=sk-...`; add `PLANNER_MODE=mock` to keep only the planner scripted. Restart with `docker compose up` after changing `.env`, and with `docker compose up --build` after changing code. Threads, paused workflows and traces live in the `demo-data` volume; `docker compose down -v` deletes them. Docker Desktop lists the project as `agent-network-demo` with one container, `mastra-server` (image `agent-network-demo`).

The container is Linux, so Windows App Control does not block the native modules there.

## Windows: App Control blocks native modules

If `npm run dev` fails with `ERR_DLOPEN_FAILED` and "An Application Control policy has blocked this file" ("Eine Anwendungssteuerungsrichtlinie hat diese Datei blockiert"), Windows Smart App Control or a company App Control policy is blocking the native `.node` files of rollup, libsql, DuckDB and esbuild. Run the demo in WSL instead. The script copies the demo into your WSL home (fast, and without the Windows `node_modules`), installs it and runs the tests:

```bash
wsl
cd /mnt/c/Users/<you>/Documents/SoftwareArchitects/basta-herbst-2026/04-agent-architecture/demo
bash scripts/wsl-setup.sh          # copies to ~/agent-demo, npm ci, npm test
cd ~/agent-demo
npm run dev:planner-mock           # or: npm run dev (put .env with the key into ~/agent-demo)
```

Run the script again after changing files on the Windows side; your `.env` in `~/agent-demo` is kept. Node 22.13 or newer is needed inside WSL.

Open http://localhost:4111/planner and http://localhost:4111/desk in the Windows browser (WSL2 forwards localhost). Work inside the WSL home, not on `/mnt/c`: it is much faster and doesn't reuse Windows `node_modules`. If npm reports that esbuild's install script was blocked and something fails, run `npm install-scripts approve esbuild` and `npm ci` again.

## Known gaps (checked 2 Nov 2026)

- The AG-UI bridge declines a tool call without a reason. The UI therefore sends the reason as a follow-up message. Mastra's own `declineToolCall({ reason })` does forward it (see tests).
- Traces live in `traces.duckdb`. Only one process can hold it, so CLI scripts keep their traces in memory. Studio shows traces from `npm run dev` (UI + Studio runs).
- Mastra's A2A agent card publishes the agent's full instructions as `description`. Fine for a demo, check it before exposing a card.
- Live planner runs make many model calls (about 25 to 45 per mode in mock counts). Test run on 16 Nov 2026, one run each: single agent about 1 minute, centralized about 4, decentralized about 2.5.
- Model ids default to `gpt-6.1-sol` (supervisors, planner hub and single agent) and `gpt-6-luna` (specialists, triage). Override with `MODEL_LARGE` / `MODEL_SMALL`.

All names, customers, logs and keys are fictional.
