// ui/voicewave.js - v4 (Josh, Nov 2: "some kind of wave form visualizer ... when the user is speaking to Juli"): a small canvas beside the
// mic. While you speak: the level of every 20 ms block the microphone's AudioWorklet hands over, as bars scrolling right to left (no
// model, no GPU: a few dozen rectangles a frame, drawn only when a new block came, at most once a frame). While Juli speaks: a quieter
// one from her audio's analyser. Its colour is the canvas's CSS colour (the chat's theme, light or dark). With prefers-reduced-motion:
// one level bar, no scrolling.
const BARS = 48;

/** bar heights (0..1) from block RMS values: a gentle log scale so speech fills the canvas and room noise stays low */
export function levelOf(rms) { const db = 20 * Math.log10(Math.max(rms, 1e-5)); return Math.max(0, Math.min(1, (db + 60) / 50)); }

export function createWave(canvas, { reduced = () => !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) } = {}) {
  const hist = new Float32Array(BARS); let n = 0, dirty = false, raf = 0, an = null, abuf = null, mode = 'off', dpr = 1, acc = 0, k = 0;
  const g = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  function size() {
    if (!canvas) return; dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function draw() {
    raf = 0; if (!g || mode === 'off') return;
    if (mode === 'juli' && an) {   // her audio: the analyser's level now, pushed like a mic block
      an.getFloatTimeDomainData(abuf); let s = 0; for (let i = 0; i < abuf.length; i++) s += abuf[i] * abuf[i];
      push(Math.sqrt(s / abuf.length)); dirty = true;
    }
    if (dirty) {
      dirty = false; size();
      const W = canvas.width, H = canvas.height, col = getComputedStyle(canvas).color || '#888';
      g.clearRect(0, 0, W, H); g.fillStyle = col; g.globalAlpha = mode === 'juli' ? 0.55 : 1;
      if (reduced()) {   // one level bar (no motion)
        const v = hist[(n - 1 + BARS) % BARS], h = Math.max(2 * dpr, v * H * 0.5);
        g.fillRect(0, (H - h) / 2, W * Math.max(0.04, v), h);
      } else {
        const bw = W / BARS, gap = Math.max(1, bw * 0.35);
        for (let i = 0; i < BARS; i++) {
          const v = n >= BARS || i >= BARS - n ? hist[(n - BARS + i + BARS * 4) % BARS] : 0, h = Math.max(2 * dpr, v * H);
          g.fillRect(i * bw + gap / 2, (H - h) / 2, bw - gap, h);
        }
      }
    }
    if (mode === 'juli') raf = requestAnimationFrame(draw);
  }
  function push(rms) { hist[n % BARS] = levelOf(rms); n++; }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  return {
    /** the microphone: one 20 ms block's RMS */
    mic(rms) { if (mode !== 'mic') return; acc = Math.max(acc, rms); if (++k % 2) return; push(acc); acc = 0; dirty = true; kick(); },   // a bar = 40 ms: about 2 s on the canvas
    /** 'mic' (you speak), 'juli' (her analyser), 'off' */
    show(m, analyser = null) {
      mode = m; an = m === 'juli' ? analyser : null; if (an && (!abuf || abuf.length !== an.fftSize)) abuf = new Float32Array(an.fftSize);
      if (m === 'off') { if (raf) cancelAnimationFrame(raf); raf = 0; if (g && canvas.width) g.clearRect(0, 0, canvas.width, canvas.height); return; }
      hist.fill(0); n = 0; dirty = true; kick();
    },
    get mode() { return mode; },
  };
}
