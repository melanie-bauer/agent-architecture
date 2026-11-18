# Product: Incident Desk

Status: written from the agreed brief (briefs/desk-brief.md), README and DEMO-CHEATSHEET without an interview. Assumptions are marked.

## What it is

A small AG-UI client for one fictional incident (Parcelly, ticket INC-4711: checkout returns 502 since 14:05). The on-call engineer talks to an **incident commander** agent. The commander delegates to two read-only specialists, **logAnalyst** and **deployHistorian**, and may request write tools (rollback, restart, public status update) that each need a human decision.

It is example 1 of the talk "Agents don't need more tools. They need architecture." The screen exists to make four architecture decisions visible while they happen:

1. Redaction at the entrance: the specialists never see the customer's name, email or card.
2. Least privilege: specialists hold read-only tools; writes exist only on the commander and need approval.
3. Approval as state: a write request ends the run with an AG-UI interrupt. Nothing runs or waits in memory until a human decides.
4. AG-UI: the UI is a reducer over a typed event stream between agent and screen.

## Who uses it

- The presenter, on stage, clicking three fixed steps (Investigate, Mitigate, Follow-up) and an approval card. She needs to know at a glance what each step does and whether it is done.
- The audience: software developers, 15 metres away, on a bright projector at 1600x900 (fallback 1280x720). They must read the point of each step from the screen without the presenter's words.
- Developers after the talk, reading the raw AG-UI events.

## Mode

Operate. A working screen with standard controls. The talk's visual world lends type, palette and one signature move only.

## Truth rules

- Mock mode is always labelled ("Mock model, scripted"). Token numbers say "estimated (mock)" or "measured (live)".
- What a specialist received is measured on the specialist's real model prompt (server CUSTOM event), never recomputed in the browser.
- Who holds which tool is read from the agents at runtime (/desk/info), never a hand-written list.

## Assumptions

- Assumed: the presenter runs the steps in order and may type free text in between. The stepper must cope with both.
- Assumed: light is the stage default; dark stays available for rehearsal on a laptop.
