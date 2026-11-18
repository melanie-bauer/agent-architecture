# Design: VibeKode Planner

Status: written from ../deck/DESIGN.md and the brief before the build, refreshed from the built UI (ui-planner/src/styles.css is the source of the tokens).

## World

The talk deck's **transit network map**, translated to a working screen. The world lends four things only: type (Overpass), palette (light ground, ink, eight line colours), density (calm, roomy, stage readable) and one signature move. Navigation, tables, tabs, buttons and inputs are standard web controls.

**Signature move: every agent is a line.** Each domain keeps its line colour from the slides. Anything an agent writes into the plan carries a station on that line: a ringed dot in the line colour plus the text "Venue (centralized)" ("Added by" or "Changed by" in front where there is room). When the change lands, the item lights up: a 3px ring and a pale tint of the line colour for about 2.5 seconds, fading out over the next 1.5. The network screen is the same map as the slides: stations coloured by domain, red A2A lines, teal tool ticks.

Physical scene: a presenter on a stage in a lit conference room, a bright projector at 1600x900, developers reading from 15 metres away. That forces a light ground, heavy ink, large type and colour that always comes with a label.

## Colour

Strategy: **full palette with roles**. Neutral shell, colour reserved for domains, A2A, and state.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#f4f7fb` | page ground (same as slides) |
| `--surface` | `#ffffff` | cards, tables, panels |
| `--panel` | `#e9eef5` | nav rail, segmented control track, table header |
| `--line` | `#d5dce6` | borders, dividers |
| `--ink` | `#12213a` | text, active states (14.9:1 on ground) |
| `--ink-2` | `#55627a` | secondary text (5.7:1 on ground) |
| `--accent` | `#d9531e` | the deck's highlight; reserved, currently only the text selection tint |

Domain lines. The line value is for edges, bars, nodes and fills. The `-text` value is for coloured text on white (all at least 5.5:1).

| Domain | Line | Text | Tint (highlight) |
|---|---|---|---|
| program | `#2f6fde` | `#2558b8` | `#e3ecfc` |
| venue | `#7a5ad8` | `#5f3fbf` | `#ece6fa` |
| catering | `#f0a33a` | `#8f5a0b` | `#fdf0dc` |
| travel | `#12a594` | `#0b7468` | `#dcf3ef` |
| budget | `#2e9e5b` | `#1f7343` | `#def2e5` |
| marketing | `#d64f8f` | `#a8336a` | `#f9e2ed` |
| access | `#e86a2c` | `#b04812` | `#fce6da` |

Network and state:

- `--a2a` `#e2483a` (text `#b8322a`): A2A messages only.
- `--tool` `#12a594`: tool ticks on the network map (MCP / tools colour from the slides).
- Warning (stale read, open risk): amber line `#f0a33a` with text `#8f5a0b` on tint `#fdf0dc`, always with an icon and a sentence.
- Problem (not step-free, over budget): red `#b8322a` text on `#fbe4e1`, always with a label.
- Live badge: teal text on teal tint. Mock badge: amber text on amber tint, text "Mock model, scripted".

## Type

- Overpass 800 for screen titles and big numbers, 600 for labels and buttons, 400 for body. Overpass Mono only for tool names and IDs in the activity log.
- Scale (px): 14 (meta, table captions, never content) / 16 (base body, table cells) / 18 (emphasis, nav) / 22 (card titles) / 28 (screen titles) / 40 (headline numbers).
- Tabular numerals for every amount and count. Amounts as `€38,600`.

## Layout

- App shell: top bar 64px; left nav 216px; main content; assistant dock 400px on the right, collapsible to a 64px rail. The dock folds away by itself on the Network screen and comes back when you leave it.
- At 1600x900 with the dock open the content area is about 980px wide; with the dock closed about 1320px. At 1440px and below the dock starts closed and opens over the content instead of pushing it, rows stack to one column and room cards go two by two.
- Spacing scale 4 / 8 / 12 / 16 / 20 / 24 / 28 / 48. Panels: white, 1px `--line` border, radius 12px, no shadow except the overlaid dock.
- Tables: about 46px rows, sticky header on `--ground`, amounts right aligned with tabular numerals.

## Components

- **Mode switch**: segmented control in the top bar, three labelled options, active option ink filled. The one-line hint ("Triage delegates to 7 specialists over A2A.") lives in the tooltip, the assistant header and the network screen.
- **Working indicator**: next to the mode switch, "2 agents working" with a pulsing dot, "Idle" otherwise.
- **Attribution (station)**: 12px ring in the line colour, writer name in the line's text colour, 14px semibold. The title attribute holds "Added by Venue (centralized) at 17:31:15". A small "new" label in the line colour shows while the change is fresh.
- **Plan item**: white card or table row with the attribution station; empty plan slots are thin outlined cells. Domain panels (Catering offer, Travel, Captions, Budget check) carry a 4px top strip in the line colour, drawn as a background so it follows the corner radius (the deck's coloured top edge).
- **Change flash**: inset ring plus tint of the owner's line, 4s in total (held, then faded). Under reduced motion the ring and tint show without animation while the change is fresh, and the "new" label marks it.
- **Budget bar**: one horizontal bar to 180,000 EUR, one segment per cost line in its domain colour, each labelled below with amount and, if the value changed after a real decision, the old value struck through; the rest of the budget shows as a light hatched track.
- **Stale check**: amber callout in a sentence ("Budget (decentralized) checked travel at €20,000 (an estimate). The plan now says €18,050."), amber frame on the Budget check panel, amber row in its table.
- **Schedule grid**: rooms as columns, times as rows, day switch above; keynote cells in ink, overflow in a lighter ink, talk cells white with a 4px top strip in the track's shade of program blue (Agents dark, AI Engineering mid, AI in Practice light); a dropped room is struck through in red with hatched cells.
- **Empty state**: a short sentence and the "Plan the conference" action.

## Motion

Ease `cubic-bezier(0.16, 1, 0.3, 1)`. Moving things: the change flash, the budget segments growing, the working indicator pulse, and the network map's live tokens and halos. No entrance animations on screens. All of it stops under reduced motion.

## Writing

English, short, plain. No dashes as punctuation, no arrows or dot separators in sentences, no buzzwords. Labels are nouns ("Budget", "Rooms"), actions are verbs ("Reset", "Plan the conference").
