// gesture.js - p0pc0rn 3.9: the shell's touch recognizer. Pure (fed pointer samples, node-testable with a fake clock) plus a small DOM
// adapter. It tells a tap from a long press, a drag (after a long press, or at once in the home screen's edit mode), a back swipe from
// the left edge and a two-finger pinch; a move that starts as a scroll is left to the browser's own scrolling (momentum included).
// The system's own gestures (the home bar at the bottom, the status bar) are never touched: nothing here listens there.
//   events: tap {x, y} · longpress {x, y} · dragstart / drag / dragend {x, y, dx, dy, cancelled?} · edgestart / edge {dx, p} /
//   edgeend {commit, dx, p, vx, cancelled?} · pinchstart / pinch / pinchend {scale, cx, cy} · cancel

export function createRecognizer({ longPressMs = 480, slop = 10, edge = 24, width = 430, commitAt = 0.33, flick = 0.45, onEvent = () => {} } = {}) {
  const P = new Map();   // pointerId -> {x0, y0, x, y, t0, t}
  let st = 'idle', first = null, dragImmediate = false, pinch0 = 1, scale = 1, hist = [];
  const W = () => Math.max(1, typeof width === 'function' ? width() : width);
  const emit = (e) => onEvent(e);
  const two = () => { const [a, b] = [...P.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; };
  const off = (p) => ({ x: p.x, y: p.y, dx: p.x - p.x0, dy: p.y - p.y0 });
  const edgeOf = (p) => { const dx = Math.max(0, p.x - p.x0); return { dx, p: Math.min(1, dx / W()) }; };
  function velocity(t, x) {   // px/ms over the last ~80 ms (or the last two samples when slower)
    hist.push({ t, x });
    let i = hist.length - 2;
    while (i > 0 && hist[i].t > t - 80) i--;
    const s = hist[Math.max(0, i)];
    return t > s.t ? (x - s.x) / (t - s.t) : 0;
  }
  function reset() { P.clear(); st = 'idle'; first = null; hist = []; scale = 1; }

  function feed(e) {
    const { type, id, x, y, t } = e;
    if (type === 'down') {
      if (st === 'idle') {
        P.set(id, { x0: x, y0: y, x, y, t0: t, t }); first = id; st = 'press'; hist = [{ t, x }];
      } else if (st === 'press' && P.size === 1 && !P.has(id)) {   // a second finger before the first moved: a pinch
        P.set(id, { x0: x, y0: y, x, y, t0: t, t }); st = 'pinch';
        const g = two(); pinch0 = Math.max(1, g.d); scale = 1;
        emit({ type: 'pinchstart', scale: 1, cx: g.cx, cy: g.cy });
      }
      return;
    }
    const p = P.get(id);
    if (!p) return;
    if (type === 'move') {
      p.x = x; p.y = y; p.t = t;
      if (st === 'pinch') { if (P.size >= 2) { const g = two(); scale = g.d / pinch0; emit({ type: 'pinch', scale, cx: g.cx, cy: g.cy }); } return; }
      if (id !== first) return;
      const dx = x - p.x0, dy = y - p.y0, far = Math.hypot(dx, dy) > slop;
      if (st === 'press' && far) {
        if (p.x0 <= edge && dx > slop && Math.abs(dx) > Math.abs(dy)) { st = 'edge'; velocity(t, x); emit(Object.assign({ type: 'edgestart' }, edgeOf(p))); emit(Object.assign({ type: 'edge' }, edgeOf(p))); }
        else if (dragImmediate) { st = 'drag'; emit(Object.assign({ type: 'dragstart' }, off(p))); emit(Object.assign({ type: 'drag' }, off(p))); }
        else st = 'scroll';
      } else if (st === 'longpress' && far) { st = 'drag'; emit(Object.assign({ type: 'dragstart' }, off(p))); emit(Object.assign({ type: 'drag' }, off(p))); }
      else if (st === 'drag') emit(Object.assign({ type: 'drag' }, off(p)));
      else if (st === 'edge') { velocity(t, x); emit(Object.assign({ type: 'edge' }, edgeOf(p))); }
      return;
    }
    if (type === 'up') {
      p.x = x; p.y = y; p.t = t;
      if (st === 'pinch') { emit({ type: 'pinchend', scale }); st = 'pinchdone'; }
      else if (id === first) {
        if (st === 'press') emit(t - p.t0 >= longPressMs ? { type: 'longpress', x: p.x0, y: p.y0 } : { type: 'tap', x, y });
        else if (st === 'drag') emit(Object.assign({ type: 'dragend' }, off(p)));
        else if (st === 'edge') { const vx = velocity(t, x), g = edgeOf(p); emit({ type: 'edgeend', commit: g.p >= commitAt || vx >= flick, dx: g.dx, p: g.p, vx }); }
      }
      P.delete(id);
      if (!P.size) reset();
      return;
    }
    if (type === 'cancel') {
      if (st === 'drag') emit(Object.assign({ type: 'dragend', cancelled: true }, off(p)));
      else if (st === 'edge') emit(Object.assign({ type: 'edgeend', commit: false, cancelled: true, vx: 0 }, edgeOf(p)));
      else if (st === 'pinch') emit({ type: 'pinchend', scale, cancelled: true });
      else if (st === 'press' || st === 'longpress') emit({ type: 'cancel' });
      reset();
    }
  }
  /** the long-press clock: the DOM adapter calls it from a timer; tests call it with their fake time */
  function tick(t) {
    const p = first != null && P.get(first);
    if (st === 'press' && p && t - p.t0 >= longPressMs) { st = 'longpress'; emit({ type: 'longpress', x: p.x0, y: p.y0 }); }
  }
  return { feed, tick, reset, set(o = {}) { if ('dragImmediate' in o) dragImmediate = !!o.dragImmediate; }, get state() { return st; } };
}

/** wire a recognizer to an element's pointer events. Returns { detach, capture(), pointer }: capture() keeps the current pointer's moves
 *  coming to `el` even when the finger leaves it (call it on dragstart / edgestart); `pointer` = the last pointerdown event */
export function attach(el, rec, { longPressMs = 480, now = () => performance.now() } = {}) {
  let timer = 0, last = null;
  const sample = (type) => (e) => {
    if (type === 'down') { last = e; clearTimeout(timer); timer = setTimeout(() => rec.tick(now()), longPressMs + 4); }
    if (type === 'up' || type === 'cancel') clearTimeout(timer);
    rec.feed({ type, id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), target: e.target });
  };
  const H = [['pointerdown', sample('down')], ['pointermove', sample('move')], ['pointerup', sample('up')], ['pointercancel', sample('cancel')]];
  for (const [k, f] of H) el.addEventListener(k, f, { passive: true });
  return {
    detach() { clearTimeout(timer); for (const [k, f] of H) el.removeEventListener(k, f); },
    capture() { try { if (last) el.setPointerCapture(last.pointerId); } catch (e) { /* the pointer is gone */ } },
    get pointer() { return last; },
  };
}
// 3.9 shell 5a41b35aec58
