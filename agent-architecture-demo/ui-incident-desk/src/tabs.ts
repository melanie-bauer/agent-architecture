// Tabs: Chat (the commander, AG-UI), Workflow (incidentTriage, live), Visualization (scripted walkthrough).
// The tab lives in the URL hash (#chat, #workflow, #viz), so a stage tab can be bookmarked.
import { $, showTabStatus, type Tab } from './shared';
import { initWorkflow } from './workflow';
import { initViz } from './viz';

const TABS: Tab[] = ['chat', 'workflow', 'viz'];
const RESET_LABEL: Record<Tab, string> = { chat: 'New thread', workflow: 'Clear runs', viz: '' };

export function initTabs({ resetChat }: { resetChat: () => void }) {
  const wf = initWorkflow();
  const viz = initViz();
  const buttons = TABS.map((t) => $<HTMLButtonElement>(`#tab-${t}`));
  const views = TABS.map((t) => $(`#view-${t}`));
  const resetBtn = $<HTMLButtonElement>('#reset');
  const resetLabel = $('#reset-label');
  let current: Tab = 'chat';

  const show = (tab: Tab, focus = false) => {
    current = tab;
    TABS.forEach((t, i) => {
      const on = t === tab;
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
      views[i].hidden = !on;
    });
    if (focus) buttons[TABS.indexOf(tab)].focus();
    document.body.dataset.tab = tab;
    document.body.classList.remove('events-open');
    resetBtn.hidden = tab === 'viz';
    resetLabel.textContent = RESET_LABEL[tab];
    $('#usage').hidden = tab !== 'chat';
    showTabStatus(tab);
    if (tab === 'viz') viz.shown();
    if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  };

  buttons.forEach((b, i) => {
    b.onclick = () => show(TABS[i]);
    b.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      show(TABS[(i + d + TABS.length) % TABS.length], true);
    };
  });
  resetBtn.onclick = () => (current === 'chat' ? resetChat() : wf.reset());

  // narrow screens (a 1280 px projector at 150 % zoom): the AG-UI panel opens as a drawer
  $('#events-toggle').onclick = () => document.body.classList.toggle('events-open');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.classList.remove('events-open');
  });

  const fromHash = () => {
    const h = location.hash.slice(1) as Tab;
    show(TABS.includes(h) ? h : 'chat');
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}
