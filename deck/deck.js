// Tiny deck engine: arrows/space/PgUp/PgDn, Home/End, F fullscreen, P presenter view, numbers + Enter to jump.
// Presenter and audience windows stay in sync via BroadcastChannel (works from file:// in Chromium too, same origin).
(() => {
  const slides = [...document.querySelectorAll('.stage > .slide')];
  const params = new URLSearchParams(location.search);
  const isPresenter = params.has('presenter');
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('agents-deck') : null;
  let i = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));

  function fit() {
    const s = Math.min(innerWidth / 1600, innerHeight / 900);
    document.documentElement.style.setProperty('--scale', s);
  }

  function show(n, from) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    history.replaceState(null, '', `${location.pathname}${location.search}#${i + 1}`);
    if (!from && chan) chan.postMessage({ i });
    if (isPresenter) renderPresenter();
  }

  // ---------- presenter view ----------
  let start = Date.now();
  let pv;
  function renderPresenter() {
    if (!pv) return;
    const cur = slides[i].cloneNode(true);
    const nxt = slides[i + 1]?.cloneNode(true);
    pv.cur.replaceChildren(cur);
    pv.nxt.replaceChildren(...(nxt ? [nxt] : []));
    [[pv.cur, cur], [pv.nxt, nxt]].forEach(([box, el]) => {
      if (!el) return;
      el.classList.add('active');
      const r = box.getBoundingClientRect();
      el.style.setProperty('--scale', Math.min(r.width / 1600, r.height / 900));
    });
    pv.notes.textContent = slides[i].querySelector('.notes')?.textContent.trim() ?? '';
    pv.pos.textContent = `${i + 1} / ${slides.length}`;
  }
  function buildPresenter() {
    document.body.classList.add('presenter');
    const root = document.createElement('div');
    root.className = 'pv';
    root.innerHTML = `
      <header><b class="clock">00:00</b><span class="pos"></span><button class="reset">reset timer</button><span>←/→ navigate · audience window: open the deck normally</span></header>
      <div class="side"><div><div class="label-s">NOW</div><div class="frame cur" style="aspect-ratio:16/9"></div></div>
      <div class="next"><div class="label-s">NEXT</div><div class="frame nxt" style="aspect-ratio:16/9"></div></div></div>
      <div class="notesbox"></div>`;
    document.querySelector('.stage').style.display = 'none';
    document.body.append(root);
    pv = { cur: root.querySelector('.cur'), nxt: root.querySelector('.nxt'), notes: root.querySelector('.notesbox'), pos: root.querySelector('.pos'), clock: root.querySelector('.clock') };
    root.querySelector('.reset').onclick = () => (start = Date.now());
    setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      pv.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    addEventListener('resize', renderPresenter);
  }

  // ---------- input ----------
  let typed = '';
  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if ((e.key === 'p' || e.key === 'P') && !isPresenter) window.open(`${location.pathname}?presenter#${i + 1}`, 'presenter', 'width=1400,height=850');
    else if (/^\d$/.test(e.key)) typed += e.key;
    else if (e.key === 'Enter' && typed) { show(parseInt(typed, 10) - 1); typed = ''; }
  });
  addEventListener('click', (e) => { if (!isPresenter && !e.target.closest('a')) show(i + (e.clientX > innerWidth / 3 ? 1 : -1)); });
  if (chan) chan.onmessage = (m) => typeof m.data?.i === 'number' && m.data.i !== i && show(m.data.i, true);

  addEventListener('resize', fit);
  fit();
  if (isPresenter) buildPresenter();
  show(i, true);
})();
