// controls.js - the touch controls: a thumbstick at the bottom right (a small fixed circle: a touch takes the stick only if it starts on
// its ring or just round it, 1.3x the ring's radius), DRIVE / CRAB / SPIN, HOLD, GRAB and DOCK on the left, and
// the camera's own layer under all of them: one finger swings the chase camera round, two fingers pinch between the chase view and
// the top view (together = zoom out to the top view, apart = back to the chase view) and turn it as they drag, a double tap puts it
// back behind the trolley. Each finger is followed on its own (pointer ids); a finger that lands on the stick or a button belongs to
// that control and never moves the camera. A keyboard works too (arrows or WASD, 1 2 3 for the modes, Space HOLD, G GRAB, V the view)
// and a mouse wheel zooms between the views.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createControls({ stickZone, stickBase, stickKnob, lookZone, modeButtons, holdButton, grabButton, dockButton,
  onMode, onOrbit, onPinch, onDoubleTap, onGrab, onDock, onView, onAny }) {
  const out = { x: 0, y: 0, hold: false, mode: null };
  const S = { id: null, cx: 0, cy: 0, r: 56, home: null };
  const shape = (v) => { const a = Math.abs(v), dz = 0.1; return a < dz ? 0 : Math.sign(v) * Math.pow((a - dz) / (1 - dz), 1.4); };
  function placeBase(x, y) { stickBase.style.left = x + 'px'; stickBase.style.top = y + 'px'; }
  function knob(dx, dy) { stickKnob.style.transform = `translate(${dx}px, ${dy}px)`; }
  function homeOf() { const z = stickZone.getBoundingClientRect(); return { x: z.width / 2, y: z.height / 2 }; }
  function rest() { S.home = homeOf(); placeBase(S.home.x, S.home.y); knob(0, 0); stickBase.classList.remove('live'); }
  stickZone.addEventListener('pointerdown', (e) => {
    if (S.id !== null) return;
    const z = stickZone.getBoundingClientRect();
    if (Math.hypot(e.clientX - z.left - z.width / 2, e.clientY - z.top - z.height / 2) > z.width / 2) return;   // outside the circle (belt and braces: CSS clips it too)
    e.preventDefault(); e.stopPropagation(); S.id = e.pointerId; try { stickZone.setPointerCapture(e.pointerId); } catch (x) { /* */ }
    S.r = 56; S.cx = z.width / 2; S.cy = z.height / 2;   // the stick stays where it is: the knob follows the thumb
    placeBase(S.cx, S.cy); stickBase.classList.add('live'); move(e); onAny && onAny();
  });
  function move(e) {
    if (e.pointerId !== S.id) return;
    const z = stickZone.getBoundingClientRect();
    let dx = e.clientX - z.left - S.cx, dy = e.clientY - z.top - S.cy; const d = Math.hypot(dx, dy);
    if (d > S.r) { dx *= S.r / d; dy *= S.r / d; }
    knob(dx, dy); out.x = shape(dx / S.r); out.y = shape(-dy / S.r);
  }
  stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === S.id) { e.preventDefault(); move(e); } });
  const end = (e) => { if (e.pointerId !== S.id) return; S.id = null; out.x = 0; out.y = 0; rest(); };
  stickZone.addEventListener('pointerup', end); stickZone.addEventListener('pointercancel', end); stickZone.addEventListener('lostpointercapture', end);

  // ---- the camera's layer: one finger orbits, two pinch (and orbit with their midpoint), a double tap resets
  const L = { pts: new Map(), pinchD: 0, midX: 0, midY: 0, tap: null, lastTap: null };
  const two = () => { const p = [...L.pts.values()]; return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; };
  lookZone.addEventListener('pointerdown', (e) => {
    if (L.pts.size >= 2) return;
    e.preventDefault(); try { lookZone.setPointerCapture(e.pointerId); } catch (x) { /* */ }
    L.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (L.pts.size === 2) { const m = two(); L.pinchD = m.d; L.midX = m.x; L.midY = m.y; L.tap = null; }
    else L.tap = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY };
    onAny && onAny();
  });
  lookZone.addEventListener('pointermove', (e) => {
    const p = L.pts.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (L.tap && Math.hypot(e.clientX - L.tap.x, e.clientY - L.tap.y) > 12) L.tap = null;
    if (L.pts.size === 1) { onOrbit && onOrbit(dx, dy); return; }
    const m = two();
    if (L.pinchD > 0 && m.d > 0) onPinch && onPinch((L.pinchD - m.d) / 180);   // > 0: the fingers came together (towards the top view)
    onOrbit && onOrbit(m.x - L.midX, 0);
    L.pinchD = m.d; L.midX = m.x; L.midY = m.y;
  });
  const lend = (e) => {
    if (!L.pts.has(e.pointerId)) return;
    L.pts.delete(e.pointerId);
    if (L.tap && L.tap.id === e.pointerId && performance.now() - L.tap.t < 260) {
      const now = performance.now(), last = L.lastTap;
      if (last && now - last.t < 340 && Math.hypot(last.x - L.tap.x, last.y - L.tap.y) < 40) { L.lastTap = null; onDoubleTap && onDoubleTap(); }
      else L.lastTap = { t: now, x: L.tap.x, y: L.tap.y };
    }
    L.tap = null;
    if (L.pts.size === 1) { const p = [...L.pts.values()][0]; L.pinchD = 0; void p; }
  };
  lookZone.addEventListener('pointerup', lend); lookZone.addEventListener('pointercancel', lend); lookZone.addEventListener('lostpointercapture', lend);
  lookZone.addEventListener('wheel', (e) => { e.preventDefault(); onPinch && onPinch(clamp(e.deltaY / 400, -0.25, 0.25)); }, { passive: false });

  // ---- modes, HOLD, GRAB, DOCK
  for (const b of modeButtons) b.addEventListener('click', (e) => { e.preventDefault(); out.mode = b.dataset.mode; onMode && onMode(b.dataset.mode); onAny && onAny(); });
  const H = { id: null };
  holdButton.addEventListener('pointerdown', (e) => { e.preventDefault(); H.id = e.pointerId; out.hold = true; holdButton.classList.add('on'); try { holdButton.setPointerCapture(e.pointerId); } catch (x) { /* */ } onAny && onAny(); });
  const hend = (e) => { if (e.pointerId !== H.id) return; H.id = null; out.hold = false; holdButton.classList.remove('on'); };
  holdButton.addEventListener('pointerup', hend); holdButton.addEventListener('pointercancel', hend); holdButton.addEventListener('lostpointercapture', hend);
  holdButton.addEventListener('contextmenu', (e) => e.preventDefault());
  if (grabButton) grabButton.addEventListener('click', (e) => { e.preventDefault(); onGrab && onGrab(); onAny && onAny(); });
  if (dockButton) dockButton.addEventListener('click', (e) => { e.preventDefault(); onDock && onDock(); onAny && onAny(); });

  // ---- keyboard (a desk or an iPad keyboard)
  const K = new Set();
  const keyAxis = () => { if (S.id !== null) return; out.y = (K.has('ArrowUp') || K.has('KeyW') ? 1 : 0) - (K.has('ArrowDown') || K.has('KeyS') ? 1 : 0); out.x = (K.has('ArrowRight') || K.has('KeyD') ? 1 : 0) - (K.has('ArrowLeft') || K.has('KeyA') ? 1 : 0); };
  addEventListener('keydown', (e) => {
    if (e.repeat && e.code !== 'Space') return;
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { out.mode = ['drive', 'crab', 'spin'][+e.code.slice(-1) - 1]; onMode && onMode(out.mode); return; }
    if (e.code === 'Space') { out.hold = true; holdButton.classList.add('on'); e.preventDefault(); return; }
    if (e.code === 'KeyG') { onGrab && onGrab(); return; }
    if (e.code === 'KeyV') { onView && onView(); return; }
    if (e.code === 'KeyF') { onDock && onDock(); return; }
    K.add(e.code); keyAxis();
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { out.hold = false; holdButton.classList.remove('on'); return; } K.delete(e.code); keyAxis(); });
  addEventListener('blur', () => { K.clear(); out.x = out.y = 0; out.hold = false; holdButton.classList.remove('on'); });

  addEventListener('resize', rest);
  rest();
  return { out, rest, set: (o) => Object.assign(out, o), look: L };
}
