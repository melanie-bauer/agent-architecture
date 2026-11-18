# Design: Incident Desk

Status: Desk specific decisions. Everything not listed here follows `../ui-planner/DESIGN.md` (world, ground, ink, type scale, spacing, radii, motion, writing) and `../../deck/DESIGN.md` (line colours). Source of the tokens: the `<style>` block in `index.html`.

## World and signature move

Same transit network map as the slides and the planner. **Signature move: the demo is a line with three stations.** The left rail draws Investigate, Mitigate and Follow-up as stations on one vertical line. A station fills when its step runs, turns amber while it waits for a human, and gets a check plus a proof sentence when done. Agents are lines too: each delegation card and timeline segment carries a station in the agent's colour.

## Colour roles (from the deck's wire slides)

| Role | Line | Text on white | Tint | Used for |
|---|---|---|---|---|
| AG-UI | `#2f6fde` | `#2558b8` | `#e3ecfc` | event labels, timeline, run status, "run ended" state box |
| Tools | `#12a594` | `#0b7468` | `#dcf3ef` | tool chips, read-only tools |
| Human decision | `#f0a33a` | `#8f5a0b` | `#fdf0dc` | approval card, waiting station, write tools that need approval |
| A2A | `#e2483a` | `#b8322a` | | not used: the Desk delegates in process, not over A2A |

Agents: commander ink `#12213a`, logAnalyst purple `#7a5ad8` (text `#5f3fbf`), deployHistorian pink `#d64f8f` (text `#a8336a`). Customer data in what the commander sent: problem red text on `#fbe4e1`. Redaction placeholders in what a specialist received: ok green `#1f7343` on `#def2e5`. Mock badge amber, live badge teal, as in the planner.

## Layout

- Top bar 64px: name, mode badge, run status, token usage, New thread, theme.
- Three columns at 1600x900: rail 320px (steps, then "Who can do what"), conversation (flexible), AG-UI panel 460px. At 1366px and below: rail 280px, panel 400px. Each column scrolls on its own.
- The approval card sticks to the bottom of the conversation while it waits, so it is always on screen.

## Components

- **Step station**: 28px ring on the line, step name (22px, 800), the exact prompt it sends, one sentence on what happens, one on what to watch. States: next (ink ring), running (blue, pulsing), waiting (amber), done (green check and a proof sentence computed from the events).
- **Roster**: per agent a row of tool chips. Read tools teal outline with "read". Write tools amber with "needs approval". One sentence under it states the rule.
- **Delegation card**: header "Commander asks logAnalyst". Two columns, "Commander sent" and "logAnalyst received", customer data marked red on the left, placeholders green on the right, and a verdict line. Below: the tools the specialist was offered, its tool calls and its answer.
- **Approval card**: amber 2px frame, header "Your decision", the request as a sentence ("Roll back checkout to v2.40.3"), tool and tier, an argument table, a blue state box ("The run has ended..."), reason field, Decline and Approve. After a decision it shrinks to one line and a blue "Run resumed" marker follows.
- **Timeline**: runs as groups ("Run 2: Mitigate", status, duration), agent segments inside, one plain sentence per step with the AG-UI event type as a small blue mono label. Streaming deltas fold into the row they belong to ("TEXT_MESSAGE x 41").
- **Raw events**: one click away (segmented control), the full JSON per event, deltas hidden by default.

## Tabs

Three views behind one segmented control in the top bar: **Chat** (the commander, as above), **Workflow** (incidentTriage, live) and **Visualization** (scripted). The tab lives in the URL hash. The top bar's status belongs to the visible tab; New thread becomes Clear runs in the Workflow tab and disappears in the Visualization.

**Who decides is a shape.** Square = code, circle = model, diamond = person (amber). The Workflow stations, the Visualization map, its legend and the caption's "Decides here" pill all use the same three shapes.

- **Workflow tab**: same three columns as the chat. Rail: two ticket cards (each with a Watch line) and the shape legend. Middle: the workflow as one line of stations in mono step names, each with a kind pill, a state ("Running", "Waiting for you", "Done", "Skipped by the branch") and its details: ticket before and after load-ticket (red vs. green marks), triage facts, the branch as two lanes (taken solid, not taken dashed), delegation cards, structured findings, the approval card inline, the outcome. Skipped steps fade to 45 %. Right: AG-UI timeline and raw events, as in the chat.
- **Visualization tab**: scenario control and Back / Step n of m / Next in a bar; the map (SVG, viewBox 1290x540, line width 8, labels in Overpass Mono) left, the caption right (decider pill, 30px title, 20px lead, data rows). The ticket is a blue dot that travels along the lines; a smaller dot travels to a specialist and back. Lines turn ink (specialists in their own colour) once travelled; the lane not taken fades to 30 %. The approval diamond pulses amber while waiting, then turns green or red. Reduced motion: no travel, the dot jumps.

## Narrow screens

Below 1200 px the AG-UI panel becomes a drawer behind an "AG-UI events" button; below 1100 px the Visualization stacks the map over the caption; below 1000 px the top bar drops the title and button labels. The mode badge always stays. On stage, use 100 % zoom for the Visualization at 1280x720.

## Type

Overpass 400/600/800 and Overpass Mono 400, self-hosted in `fonts/`. Base 16px; labels and mono event types 14px, never smaller; step names and card titles 22px; the approval request 28px.

## Dark theme

Optional, toggled in the top bar and remembered per browser. Same roles on ground `#0f1828`, surfaces `#172338`, ink `#e8eef6`; coloured text uses the line value or lighter.
