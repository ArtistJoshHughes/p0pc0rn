// back.js - p0pc0rn v026.9: the Android back button (and a desktop browser's Back) closes the open sheet, viewer or dialog instead of
// leaving the app. Every open dialog ([role="dialog"], visible) has one history entry of its own; Back closes the top one the way its own
// close control does ([data-close], a Close button). A dialog closed by its own button gives its entry back silently.
const visible = (d) => d.getClientRects().length > 0 && !d.closest('[hidden]');
const openDialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible);
function closeOne(d) {
  const wrap = d.closest('.sheet-wrap') || d.parentElement || d;
  const b = d.querySelector('[data-close], [aria-label="Close"], #mvb-close') || wrap.querySelector('[data-close], [aria-label="Close"]');
  if (b) { b.click(); return true; }
  return false;
}
export function initBack({ enabled = false } = {}) {
  if (!enabled || !window.history || !history.pushState) return null;
  let pushed = 0, ignore = 0, raf = 0;
  const sync = () => {
    raf = 0;
    const n = openDialogs().length;
    if (n > pushed) { for (; pushed < n; pushed++) history.pushState({ pfBack: pushed + 1 }, ''); }
    else if (n < pushed) { const k = pushed - n; pushed = n; ignore++; history.go(-k); }
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(sync); };
  new MutationObserver(later).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  addEventListener('popstate', () => {
    if (ignore > 0) { ignore--; return; }
    const list = openDialogs(); pushed = Math.max(0, pushed - 1);
    const top = list[list.length - 1];
    if (top && !closeOne(top)) { history.pushState({ pfBack: ++pushed }, ''); }   // a dialog that can't be closed (the agreement) keeps its entry
  });
  later();
  return { get depth() { return pushed; } };
}
