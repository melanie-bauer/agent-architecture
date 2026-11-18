// Builds index.html (the deck) and NOTES.md (speaker script) from slides.mjs.
// Usage: node build.mjs
// Note: Overpass draws U+00B7 (middle dot) hard against the next word, so slide separators are rendered as • (bullet).
import { writeFileSync } from 'node:fs';
import { slides } from './slides.mjs';

const ROUTE = [
  { seg: 'Theory', stops: ['Start', 'Basics', 'Specialists', 'Long tasks', 'Risky tools', 'Users', 'Does it work?'] },
  { seg: 'Example', stops: ['Planner demo'] },
  { seg: 'Takeaways', stops: ['Takeaways'] },
];
const ALL = ROUTE.flatMap((r, si) => r.stops.map((s) => ({ s, si })));
const SEGCOL = ['#2f6fde', '#7a5ad8', '#f0a33a'];

function routeBar(here) {
  const W = 1408, y = 18, n = ALL.length;
  const gapSeg = 60;
  const step = (W - gapSeg * (ROUTE.length - 1)) / (n - 1);
  let x = 0, prevSeg = 0;
  const pos = ALL.map((st, k) => {
    if (k > 0) x += step + (st.si !== prevSeg ? gapSeg : 0);
    prevSeg = st.si;
    return x;
  });
  const PAD = 60; // room for the first and last label, so every label is centred under its station
  const scale = (W - 2 * PAD) / pos[n - 1];
  let out = '';
  ROUTE.forEach((r, si) => {
    const xs = ALL.map((s, k) => (s.si === si ? PAD + pos[k] * scale : null)).filter((v) => v !== null);
    const a = xs[0], b = xs[xs.length - 1];
    out += `<line x1="${a - 2}" y1="${y}" x2="${b + 2 || a + 2}" y2="${y}" stroke="${SEGCOL[si]}" stroke-width="8" stroke-linecap="round"/>`;
  });
  ALL.forEach((st, k) => {
    const cx = PAD + pos[k] * scale;
    const isHere = k === here;
    const done = here !== null && k < here;
    out += `<circle cx="${cx}" cy="${y}" r="${isHere ? 13 : 9}" style="fill:${isHere || done ? SEGCOL[st.si] : 'var(--ground)'}" stroke="${SEGCOL[st.si]}" stroke-width="${isHere ? 0 : 5}"/>`;
    if (isHere) out += `<circle cx="${cx}" cy="${y}" r="5" fill="#fff"/>`;
    const anchor = 'middle';
    out += `<text x="${cx}" y="${y + 36}" text-anchor="${anchor}" class="${isHere ? 'here' : ''}">${st.s}</text>`;
  });
  return `<div class="route" aria-hidden="true"><svg viewBox="0 -6 ${W} 62" preserveAspectRatio="none">${out}</svg></div>`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agents Need Architecture</title>
<link rel="stylesheet" href="deck.css"></head>
<body><main class="stage">
`;
const md = ['# Speaker notes · Agents Don’t Need More Tools. They Need Architecture.', '', '_Generated from deck/slides.mjs. Edit there._', ''];
slides.forEach((s, k) => {
  html += `<section class="slide ${s.cls ?? ''}" aria-label="${esc(s.title)}">
${s.html.replace(/ · /g, ' • ')}
${s.route == null ? '' : routeBar(s.route)}
<aside class="notes">${esc(s.notes)}</aside>
</section>
`;
  md.push(`## ${k + 1} · ${s.title}${s.time ? `  _(${s.time})_` : ''}`, '', s.notes, '');
});
html += `</main><script src="deck.js"></script></body></html>\n`;
writeFileSync(new URL('./index.html', import.meta.url), html);
writeFileSync(new URL('./NOTES.md', import.meta.url), md.join('\n'));
console.log(`deck: ${slides.length} slides`);
