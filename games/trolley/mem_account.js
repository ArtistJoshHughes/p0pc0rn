// mem_account.js - the game's own page memory, counted as it is made: WebGL textures (their mip chains), buffers and renderbuffers as
// they are given to the GL, the canvas's drawing buffer (with its multisampling), the 2D canvases the game draws its textures on, the
// decoded images still alive (ImageBitmaps until they are closed), Rapier's WebAssembly memory and, where the browser says (Chrome), the
// JS heap. Safari tells a page nothing about its own footprint, so this is the game's side of the phone's page budget (the probe overlay
// and the phone bench show it). Installed before three.js makes its context (main.js imports it first) and only where it is read: the
// bench, the desk (?test, ?lowmem) or the probe switched on at load. Every hook is a thin wrapper that calls the original.
const MB = 1048576;
/** bytes a texel of an internal format takes (WebGL 2 sized formats; unsized and unknown ones count as RGBA8) */
const BPP = (() => {
  const t = {};
  // the GL enums by value (the same in every WebGL 2 context)
  const set = (v, b) => { t[v] = b; };
  set(0x1908, 4); set(0x8058, 4); set(0x8C43, 4); set(0x1907, 3); set(0x8051, 3); set(0x8C41, 3);   // RGBA, RGBA8, SRGB8_ALPHA8, RGB, RGB8, SRGB8
  set(0x881A, 8); set(0x8814, 16); set(0x881B, 6); set(0x8815, 12); set(0x822F, 4); set(0x8230, 8);  // RGBA16F, RGBA32F, RGB16F, RGB32F, RG16F, RG32F
  set(0x822D, 2); set(0x822E, 4); set(0x8229, 1); set(0x822B, 2); set(0x1903, 1); set(0x1909, 1); set(0x190A, 2);   // R16F, R32F, R8, RG8, RED, LUMINANCE, LUMINANCE_ALPHA
  set(0x81A5, 2); set(0x81A6, 4); set(0x8CAC, 4); set(0x88F0, 4); set(0x8CAD, 8); set(0x1902, 4); set(0x84F9, 4);   // DEPTH16, DEPTH24, DEPTH32F, DEPTH24_STENCIL8, DEPTH32F_STENCIL8, DEPTH_COMPONENT, DEPTH_STENCIL
  set(0x8D48, 1); set(0x8C3A, 4); set(0x8C3D, 4); set(0x8059, 4); set(0x8D62, 2); set(0x8056, 2); set(0x8057, 2);   // STENCIL8, R11F_G11F_B10F, RGB9_E5, RGB10_A2, RGB565, RGBA4, RGB5_A1
  return t;
})();
const bppOf = (internal, format, type) => {
  if (BPP[internal]) {
    if ((internal === 0x1908 || internal === 0x1907) && (type === 0x140B || type === 0x8D61)) return internal === 0x1908 ? 8 : 6;   // RGBA / RGB with HALF_FLOAT
    if ((internal === 0x1908 || internal === 0x1907) && type === 0x1406) return internal === 0x1908 ? 16 : 12;                      // ... with FLOAT
    return BPP[internal];
  }
  return 4;
};
/** createAccount() -> { install(), installed, snapshot(), peak, note(label) }: one per page */
export function createAccount() {
  const A = { installed: false, tex: 0, buf: 0, rb: 0, bitmaps: 0, peakMB: 0, peakAt: '', notes: [], canvases: new Set(), wasm: [], gls: new Set() };
  const texSize = new WeakMap(), bufSize = new WeakMap(), rbSize = new WeakMap(), bound = new WeakMap(), bmSize = new WeakMap();
  const B = (gl) => { let b = bound.get(gl); if (!b) bound.set(gl, b = { unit: 0, tex: new Map(), buf: new Map(), rb: null }); return b; };
  const texKey = (gl, target) => (target >= 0x8515 && target <= 0x851A ? 0x8513 : target);   // a cube face -> the cube map
  const curTex = (gl, target) => B(gl).tex.get(B(gl).unit + ':' + texKey(gl, target));
  const setTex = (tex, info) => { const o = texSize.get(tex) || { lv: new Map(), mips: false, bytes: 0 }; Object.assign(o, info || {}); texSize.set(tex, o); return o; };
  const recount = (tex, o) => {
    let b = 0; for (const v of o.lv.values()) b += v;
    if (o.mips && o.lv.size <= 1) b = Math.round(b * 4 / 3);   // generateMipmap: the chain under level 0
    A.tex += b - o.bytes; o.bytes = b;
  };
  function wrapGL(P) {
    if (!P || P.__p0acct) return; P.__p0acct = true;
    const W = (name, after) => { const f = P[name]; if (typeof f !== 'function') return; P[name] = function () { const r = f.apply(this, arguments); try { after(this, arguments, r); } catch (e) { /* the count only */ } return r; }; };
    W('activeTexture', (gl, a) => { B(gl).unit = a[0]; });
    W('bindTexture', (gl, a) => { B(gl).tex.set(B(gl).unit + ':' + a[0], a[1]); });
    W('bindBuffer', (gl, a) => { B(gl).buf.set(a[0], a[1]); });
    W('bindRenderbuffer', (gl, a) => { B(gl).rb = a[1]; });
    W('texImage2D', (gl, a) => {
      const t = curTex(gl, a[0]); if (!t) return;
      let w, h, internal, format, type; const lvl = a[1] | 0;
      if (a.length >= 8) { internal = a[2]; w = a[3]; h = a[4]; format = a[6]; type = a[7]; }
      else { internal = a[2]; format = a[3]; type = a[4]; const src = a[5] || {}; w = src.videoWidth || src.naturalWidth || src.width || 0; h = src.videoHeight || src.naturalHeight || src.height || 0; }
      const o = setTex(t), face = a[0] >= 0x8515 && a[0] <= 0x851A ? a[0] : 0;
      o.lv.set(lvl + ':' + face, (w | 0) * (h | 0) * bppOf(internal, format, type)); recount(t, o);
    });
    W('compressedTexImage2D', (gl, a) => { const t = curTex(gl, a[0]); if (!t) return; const o = setTex(t), src = a[6]; o.lv.set((a[1] | 0) + ':' + a[0], src && src.byteLength ? src.byteLength : (a[3] * a[4]) / 2); recount(t, o); });
    W('texStorage2D', (gl, a) => {
      const t = curTex(gl, a[0]); if (!t) return; const levels = a[1] | 0, bpp = bppOf(a[2]), faces = texKey(gl, a[0]) === 0x8513 ? 6 : 1;
      let b = 0, w = a[3], h = a[4]; for (let i = 0; i < levels; i++) { b += Math.max(1, w) * Math.max(1, h) * bpp; w >>= 1; h >>= 1; }
      const o = setTex(t); o.lv.clear(); o.lv.set('storage', b * faces); recount(t, o);
    });
    W('texImage3D', (gl, a) => { const t = curTex(gl, a[0]); if (!t) return; const o = setTex(t); o.lv.set((a[1] | 0) + ':3d', a[3] * a[4] * a[5] * bppOf(a[2], a[7], a[8])); recount(t, o); });
    W('texStorage3D', (gl, a) => { const t = curTex(gl, a[0]); if (!t) return; const o = setTex(t); let b = 0, w = a[3], h = a[4]; for (let i = 0; i < a[1]; i++) { b += Math.max(1, w) * Math.max(1, h) * a[5] * bppOf(a[2]); w >>= 1; h >>= 1; } o.lv.clear(); o.lv.set('storage', b); recount(t, o); });
    W('generateMipmap', (gl, a) => { const t = curTex(gl, a[0]); if (!t) return; const o = setTex(t); if (!o.mips) { o.mips = true; recount(t, o); } });
    W('deleteTexture', (gl, a) => { const t = a[0], o = t && texSize.get(t); if (o) { A.tex -= o.bytes; texSize.delete(t); } });
    W('bufferData', (gl, a) => {
      const b = B(gl).buf.get(a[0]); if (!b) return; const n = typeof a[1] === 'number' ? a[1] : a[1] ? a[1].byteLength || 0 : 0;
      A.buf += n - (bufSize.get(b) || 0); bufSize.set(b, n);
    });
    W('deleteBuffer', (gl, a) => { const b = a[0], n = b && bufSize.get(b); if (n) { A.buf -= n; bufSize.delete(b); } });
    const rbs = (gl, samples, internal, w, h) => { const r = B(gl).rb; if (!r) return; const n = Math.max(1, samples | 0) * w * h * bppOf(internal); A.rb += n - (rbSize.get(r) || 0); rbSize.set(r, n); };
    W('renderbufferStorage', (gl, a) => rbs(gl, 1, a[1], a[2], a[3]));
    W('renderbufferStorageMultisample', (gl, a) => rbs(gl, a[1], a[2], a[3], a[4]));
    W('deleteRenderbuffer', (gl, a) => { const r = a[0], n = r && rbSize.get(r); if (n) { A.rb -= n; rbSize.delete(r); } });
  }
  function install() {
    if (A.installed) return A; A.installed = true;
    try { wrapGL(globalThis.WebGL2RenderingContext && WebGL2RenderingContext.prototype); wrapGL(globalThis.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch (e) { /* no WebGL here */ }
    // the canvases: a WebGL one's drawing buffer, a 2D one's pixels (the game draws its own textures on 2D canvases)
    try {
      const gc = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, opts) {
        const c = gc.call(this, kind, opts);
        try { if (c && /^webgl/.test(kind)) A.gls.add({ canvas: this, gl: c }); else if (c && kind === '2d') A.canvases.add(typeof WeakRef === 'function' ? new WeakRef(this) : { deref: () => this }); } catch (e) { /* */ }
        return c;
      };
    } catch (e) { /* no DOM */ }
    // decoded images: an ImageBitmap holds its pixels until close()
    try {
      if (typeof createImageBitmap === 'function') {
        const cib = globalThis.createImageBitmap;
        globalThis.createImageBitmap = function () { return cib.apply(this, arguments).then((bm) => { try { const n = bm.width * bm.height * 4; bmSize.set(bm, n); A.bitmaps += n; } catch (e) { /* */ } return bm; }); };
        const close = ImageBitmap.prototype.close;
        ImageBitmap.prototype.close = function () { const n = bmSize.get(this); if (n) { A.bitmaps -= n; bmSize.delete(this); } return close.call(this); };
      }
    } catch (e) { /* */ }
    // WebAssembly memories (Rapier's): every instance's exported memory
    try {
      const WA = globalThis.WebAssembly, keep = (inst) => { try { const ex = inst && (inst.instance || inst).exports; if (ex) for (const v of Object.values(ex)) if (v instanceof WA.Memory) A.wasm.push(v); } catch (e) { /* */ } return inst; };
      for (const k of ['instantiate', 'instantiateStreaming']) if (WA && typeof WA[k] === 'function') { const f = WA[k]; WA[k] = function () { return f.apply(this, arguments).then(keep); }; }
    } catch (e) { /* */ }
    return A;
  }
  /** the drawing buffer of each WebGL canvas: colour + depth/stencil, times its samples when multisampled, plus the resolve */
  function drawingBuffers() {
    let b = 0;
    for (const { canvas, gl } of A.gls) {
      try {
        const px = (gl.drawingBufferWidth || canvas.width) * (gl.drawingBufferHeight || canvas.height), at = gl.getContextAttributes ? gl.getContextAttributes() || {} : {};
        const s = at.antialias ? Math.max(4, gl.getParameter(gl.SAMPLES) || 4) : 1;
        b += px * (4 + (at.depth !== false ? 4 : 0)) * s + (s > 1 ? px * 4 : 0) + px * 4;   // + the displayed copy
      } catch (e) { /* lost */ }
    }
    return b;
  }
  function canvas2d() { let b = 0; for (const r of [...A.canvases]) { const c = r.deref(); if (!c) { A.canvases.delete(r); continue; } b += (c.width || 0) * (c.height || 0) * 4; } return b; }
  /** -> { texMB, bufMB, rbMB, drawMB, canvasMB, imagesMB, wasmMB, heapMB|null, totalMB } and the peak so far */
  function snapshot(label = '') {
    const r = (v) => Math.round(v / MB);
    const wasm = A.wasm.reduce((s, m) => s + ((m.buffer && m.buffer.byteLength) || 0), 0);
    const pm = globalThis.performance && performance.memory, heap = pm && pm.usedJSHeapSize ? pm.usedJSHeapSize : null;
    const s = { texMB: r(A.tex), bufMB: r(A.buf), rbMB: r(A.rb), drawMB: r(drawingBuffers()), canvasMB: r(canvas2d()), imagesMB: r(A.bitmaps), wasmMB: r(wasm), heapMB: heap == null ? null : r(heap) };
    s.gpuMB = s.texMB + s.bufMB + s.rbMB + s.drawMB;
    s.totalMB = s.gpuMB + s.canvasMB + s.imagesMB + s.wasmMB + (s.heapMB || 0);
    if (s.totalMB > A.peakMB) { A.peakMB = s.totalMB; A.peakAt = label || A.peakAt; A.peak = s; }
    return s;
  }
  return { install, snapshot, get installed() { return A.installed; }, get peakMB() { return A.peakMB; }, get peak() { return A.peak || null; }, get peakAt() { return A.peakAt; }, A };
}
/** the page's one account (main.js installs it when it is read) */
export const MEM = createAccount();
/** a short line for the probe: "game 412 MB (GPU 301, wasm 34, js 61)" */
export function memLine(s) {
  if (!s) return 'game mem: n/a';
  return `game ${s.totalMB} MB (GPU ${s.gpuMB} · img ${s.imagesMB + s.canvasMB} · wasm ${s.wasmMB}${s.heapMB != null ? ' · js ' + s.heapMB : ''})`;
}
