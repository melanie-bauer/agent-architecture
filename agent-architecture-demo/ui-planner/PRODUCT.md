# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, one screen.

1. **The presenter.** Melanie Bauer, software architect, drives the planner live on stage during the 45-minute talk "Agents don't need more tools. They need architecture." She switches between three agent topologies, sends one planning request, and talks over what happens. She needs every important state reachable in one click and nothing that surprises her mid-demo.
2. **The room.** Software developers in a mid-size conference room, reading a bright projector at 1600x900 (fallback 1280x720) from up to the back row. They must see who is working, who talks to whom, and what each agent changed in the plan, without reading chat text.

## Product Purpose

A conference-planning tool for the fictional event **VibeKode 2027** (AI-focused developer conference, 2 days, 600 attendees, budget 180,000 EUR) whose planning is done by an AI agent system. The same request runs as:

- **Single agent**: one agent with every tool.
- **Centralized**: a supervisor ("triage") delegates to 7 specialists over A2A.
- **Decentralized**: 7 peers ask each other over A2A and share a plan board.

Success: after one run in each mode the audience can point at the plan, see which agent wrote which part, and see the consequence of the topology (the hub relaying a finding in centralized mode, the stale budget read in decentralized mode).

## Positioning

It looks and behaves like ordinary event-planning software: schedule, rooms, catering, travel, budget. The AI is a docked assistant, not the page. That framing is the point of the talk: the architecture of the agents shows up as attributed changes in real planning data, not as a chat transcript.

## Operating Context

- Live on stage, presenter laptop mirrored to a projector. Light room, bright projector, high contrast needed.
- Backend: Mastra server (Docker on the presenter's Windows laptop) at http://localhost:4111/planner. Agents run against OpenAI in live mode; a scripted mock model exists for tests and offline fallback.
- The live network view (nodes, A2A lines, tool ticks, counters, activity log, compare runs) is part of the story and stays one click away.
- Slides live in ../deck and share the colour language with this app.

## Capabilities and Constraints

- Three modes, CopilotKit agents `single`, `centralized`, `decentralized`. A2A in both network modes, depth limit 3, 12 messages per request, specialists and peers hold only their own domain's tools. These are the subject of the talk and must not change.
- Seven domains, each with a fixed colour shared with the slides: program, venue, catering, travel, budget, marketing, accessibility.
- Base data is fixed and fictional (submissions, speakers, rooms, caterers, ledger, tickets, sponsors). The plan is written by agents through write tools into an in-memory plan store, one plan per mode, cleared by reset.
- Every number in the UI comes from the base data or the plan store. Nothing invented, nothing presented as a measurement unless measured.
- Mock mode must be clearly labelled as scripted.

## Brand Commitments

- Visual language shared with the talk deck (../deck/DESIGN.md): transit network map world, light ground, Overpass, one colour per planner domain, red for A2A.
- Copy: English, short, plain. No dashes as punctuation, no arrows or dot separators in sentences, no buzzwords.

## Evidence on Hand

- Base data: src/mastra/planner/data.ts (fictional, labelled as such).
- Baseline screenshots of the old chat plus network UI taken before the redesign.
- No live-model measurements are stored; run counters shown in Compare runs are measured per run on the presenter's machine and labelled that way.

## Product Principles

1. The plan is the hero. Agents are visible through what they change.
2. Attribution everywhere: every plan entry says which agent, in which mode, when.
3. One click to anything the talk needs: mode switch, reset, network view, assistant.
4. Honest numbers: data or plan store only; mock is labelled.
5. Stage first: readable from the back row before it is dense.

## Accessibility & Inclusion

Projector readability: base font at least 16px, nothing important below 14px, high contrast on a bright light ground. Domain colour is never the only carrier of meaning: every coloured element also has a text label. Respect reduced motion for highlights and network animation.
