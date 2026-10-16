// Pocket Voice: the Qwen3-TTS talker (28 layers) + code predictor (5 layers, 15 heads) on WebGPU, weights resident.
//   prefill(rows f32 [L][1024])   tiled GEMMs (f16 activations, f32 accumulate) + causal attention, fills the talker KV cache
//   generate({...})               the frame loop: one talker step + a 2-token code-predictor prefill + 14 code-predictor steps per frame,
//                                 all sampling on the GPU (no CPU round trip per code); EOS is read back 2 frames behind.
// spec: the p0pc0rn Qwen3-TTS 0.6B spec, sections 0, 1.4, 1.5.
'use strict';
import { vgemm } from './vgemm.js';
import { gemv, rmsrow, qkrope, attn, sampler, rowgather, ropeTable } from './vops.js';

const D = 1024, HQ = 16, HKV = 8, HD = 128, MLP = 3072, QKV = (HQ + 2 * HKV) * HD;

export class Talker {
  constructor(gpu, store) { this.g = gpu; this.s = store; this.m = store.m; this.cfg = store.m.model; this.h = null; }
  W(h, name) {
    const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name);
    const src = x.src || {};
    return { buf: h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1],
      n: src.n != null ? src.n : x.shape[0], k: src.k != null ? src.k : x.shape[x.shape.length - 1], src, ld: x.shape[x.shape.length - 1] };
  }
  F(h, name) { const x = this.m.tensors[`${h.name}/${name}`]; if (!x) throw new Error('tensor missing: ' + h.name + '/' + name); return x.offset / 4; }

  async load(onPart) {
    if (this.h) return;
    const s = this.s, t = this.cfg.talker, c = this.cfg.cp, h = { layers: [], cp: [] };
    const parts = ['talker.global', 'cp.global', ...Array.from({ length: t.layers }, (_, i) => `talker.layer.${String(i).padStart(2, '0')}`), ...Array.from({ length: c.layers }, (_, i) => `cp.layer.${i}`)];
    for (let i = 0; i < parts.length; i++) {
      const sh = await s.upload(parts[i]);
      if (parts[i] === 'talker.global') h.tg = sh; else if (parts[i] === 'cp.global') h.cg = sh;
      else if (parts[i].startsWith('talker.layer')) h.layers.push(sh); else h.cp.push(sh);
      if (onPart) onPart(i + 1, parts.length);
    }
    this.h = h;
    this.rope = this.g.upload(ropeTable(4096, HD, t.rope_theta || 1e6), 'tk.rope');   // positions 0..4095 (cos | sin)
    this.ropeSin = 4096 * HD / 2;
    const g = this.g;
    this.cpIn = g.buffer(2 * D * 4, 'tk.cpIn'); this.cpK = h.cp.map(() => g.buffer(HKV * 16 * HD * 2, 'tk.cpK')); this.cpV = h.cp.map(() => g.buffer(HKV * 16 * HD * 2, 'tk.cpV'));
    this.xr = g.buffer(D * 4, 'tk.xr'); this.qkv = g.buffer(2 * QKV * 4, 'tk.qkv'); this.q = g.buffer(2 * HQ * HD * 4, 'tk.q'); this.o = g.buffer(2 * HQ * HD * 4, 'tk.o');
    this.hm = g.buffer(2 * MLP * 4, 'tk.h'); this.hn = g.buffer(D * 4, 'tk.hn'); this.logits = g.buffer(3072 * 4, 'tk.logits'); this.state = g.buffer(4 * D * 4, 'tk.state');
    this.seen = g.buffer(512, 'tk.seen');
    // probes v002: the code-0 (EOS) readback ring lives as long as the talker (it was created and destroyed per line)
    this.ring = []; for (let i = 0; i < 4; i++) this.ring.push({ buf: g.device.createBuffer({ size: 64, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'tk.eos' }), k: -1, p: null });
  }
  unload() {
    const g = this.g; g.runner.flush();
    if (this.h) { for (const sh of [this.h.tg, this.h.cg, ...this.h.layers, ...this.h.cp]) this.s.release(sh); this.h = null; }
    for (const b of [this.rope, this.cpIn, ...(this.cpK || []), ...(this.cpV || []), this.xr, this.qkv, this.q, this.o, this.hm, this.hn, this.logits, this.state, this.seen]) if (b) g.free(b);
    for (const r of this.ring || []) { try { if (r.p) r.buf.unmap(); } catch (e) { /* */ } try { r.buf.destroy(); } catch (e) { /* */ } }
    this.ring = null; this.cpK = this.cpV = null; this.freeKV();
  }
  freeKV() { if (this.kc) { this.g.runner.flush(); for (const b of [...this.kc, ...this.vc]) this.g.free(b); } this.kc = this.vc = null; this.Lmax = 0; }
  allocKV(Lmax) {
    if (this.kc && this.Lmax >= Lmax) return;
    this.freeKV(); const g = this.g;
    this.Lmax = Math.ceil(Lmax / 64) * 64;
    this.kc = this.h.layers.map(() => g.buffer(HKV * this.Lmax * HD * 2, 'tk.kc')); this.vc = this.h.layers.map(() => g.buffer(HKV * this.Lmax * HD * 2, 'tk.vc'));
  }

  /** the codec rows of the prefill (rowgather spec rows) + the base rows (CPU) -> GPU buffer [L][1024] f32 */
  assemble(base, L, gather) {
    const g = this.g, rows = g.upload(base, 'tk.pre');
    if (gather.length) {
      const n = gather.length, spec = new Uint32Array(n * 17).fill(0xffffffff);
      gather.forEach((r, i) => { spec[i * 17] = r.dst; spec[i * 17 + 1] = r.c0 != null ? r.c0 : 0xffffffff; if (r.rest) for (let q = 0; q < 15; q++) spec[i * 17 + 2 + q] = r.rest[q]; });
      const sb = g.upload(spec, 'tk.spec');
      const ce = this.W(this.h.tg, 'codec_emb'), cpe = this.W(this.h.cg, 'emb');
      rowgather(g, { e0: { buf: ce.buf, off: ce.off / 2 }, e1: { buf: cpe.buf, off: cpe.off / 2, rows: 2048 }, out: { buf: rows }, add: true }, sb, n);
      g.runner.flush(); g.free(sb);
    }
    return rows;
  }

  /** run the talker over prefill rows [L][1024] (GPU buffer), positions 0..L-1; leaves hn (final normed hidden of row L-1) and logits */
  prefill(rows, L) {
    const g = this.g, t = this.cfg.talker, eps = t.rms_eps || 1e-6, B = [];
    const buf = (n, l) => { const b = g.buffer(n, l); B.push(b); return b; };
    const x16 = buf(L * D * 2 + 256, 'pf.x16'), qkv = buf(L * QKV * 4 + 256, 'pf.qkv'), q = buf(L * HQ * HD * 4 + 256, 'pf.q'), o16 = buf(L * HQ * HD * 2 + 256, 'pf.o'), h16 = buf(L * MLP * 2 + 256, 'pf.h');
    this.h.layers.forEach((sh, i) => {
      rmsrow(g, { x: { buf: rows }, M: L, K: D, w: { buf: sh.buf, off: this.F(sh, 'ln1') }, eps, y: { buf: x16 }, f16: true });
      vgemm(g, { w: this.W(sh, 'qkv'), x: { buf: x16, ld: D }, M: L, N: QKV, K: D, y: { buf: qkv, ld: QKV }, epi: 'f32' });
      qkrope(g, { qkv: { buf: qkv, ld: QKV }, M: L, Hq: HQ, Hkv: HKV, D: HD, pos0: 0, q: { buf: q, ld: HQ * HD }, kc: { buf: this.kc[i] }, vc: { buf: this.vc[i] }, Lmax: this.Lmax,
        norm: { buf: sh.buf, q: this.F(sh, 'qn'), k: this.F(sh, 'kn'), eps }, rope: { buf: this.rope, sinOff: this.ropeSin } });
      attn(g, { q: { buf: q, ld: HQ * HD }, M: L, Hq: HQ, Hkv: HKV, D: HD, pos0: 0, window: 0, Lmax: this.Lmax, kc: { buf: this.kc[i] }, vc: { buf: this.vc[i] }, o: { buf: o16, ld: HQ * HD }, f16out: true });
      vgemm(g, { w: this.W(sh, 'o'), x: { buf: o16, ld: HQ * HD }, M: L, N: D, K: HQ * HD, y: { buf: rows, ld: D }, epi: 'add' });
      rmsrow(g, { x: { buf: rows }, M: L, K: D, w: { buf: sh.buf, off: this.F(sh, 'ln2') }, eps, y: { buf: x16 }, f16: true });
      vgemm(g, { w: this.W(sh, 'gu'), x: { buf: x16, ld: D }, M: L, N: 2 * MLP, K: D, y: { buf: h16, ld: MLP }, epi: 'swiglu', wr0: 0, wr1: MLP });
      vgemm(g, { w: this.W(sh, 'down'), x: { buf: h16, ld: MLP }, M: L, N: D, K: MLP, y: { buf: rows, ld: D }, epi: 'add' });
    });
    rmsrow(g, { x: { buf: rows, off: (L - 1) * D }, M: 1, K: D, w: { buf: this.h.tg.buf, off: this.F(this.h.tg, 'norm') }, eps, y: { buf: this.cpIn } });
    gemv(g, { w: this.W(this.h.tg, 'codec_head'), x: { buf: this.cpIn }, M: 1, N: 3072, K: D, y: { buf: this.logits }, epi: 'store' });
    g.runner.flush(); for (const b of B) g.free(b);
    this.pos = L;
  }

  /** one talker decode step on xr (the input embedding, already in xr) at position p -> hn in cpIn row 0, logits */
  step(p) {
    const g = this.g, eps = this.cfg.talker.rms_eps || 1e-6;
    this.h.layers.forEach((sh, i) => {
      gemv(g, { w: this.W(sh, 'qkv'), x: { buf: this.xr }, M: 1, N: QKV, K: D, y: { buf: this.qkv }, epi: 'store', norm: { buf: sh.buf, off: this.F(sh, 'ln1'), eps } });
      qkrope(g, { qkv: { buf: this.qkv, ld: QKV }, M: 1, Hq: HQ, Hkv: HKV, D: HD, pos0: p, q: { buf: this.q, ld: HQ * HD }, kc: { buf: this.kc[i] }, vc: { buf: this.vc[i] }, Lmax: this.Lmax,
        norm: { buf: sh.buf, q: this.F(sh, 'qn'), k: this.F(sh, 'kn'), eps }, rope: { buf: this.rope, sinOff: this.ropeSin } });
      attn(g, { q: { buf: this.q, ld: HQ * HD }, M: 1, Hq: HQ, Hkv: HKV, D: HD, pos0: p, window: 0, Lmax: this.Lmax, kc: { buf: this.kc[i] }, vc: { buf: this.vc[i] }, o: { buf: this.o, ld: HQ * HD } });
      gemv(g, { w: this.W(sh, 'o'), x: { buf: this.o }, M: 1, N: D, K: HQ * HD, y: { buf: this.xr }, epi: 'add' });
      gemv(g, { w: this.W(sh, 'gu'), x: { buf: this.xr }, M: 1, N: MLP, K: D, y: { buf: this.hm }, epi: 'swiglu', rowOff: 0, wr1: MLP, norm: { buf: sh.buf, off: this.F(sh, 'ln2'), eps } });
      gemv(g, { w: this.W(sh, 'down'), x: { buf: this.hm }, M: 1, N: D, K: MLP, y: { buf: this.xr }, epi: 'add' });
    });
    rmsrow(g, { x: { buf: this.xr }, M: 1, K: D, w: { buf: this.h.tg.buf, off: this.F(this.h.tg, 'norm') }, eps, y: { buf: this.cpIn } });
    gemv(g, { w: this.W(this.h.tg, 'codec_head'), x: { buf: this.cpIn }, M: 1, N: 3072, K: D, y: { buf: this.logits }, epi: 'store' });
  }

  /** code predictor over x rows (cpIn: M = 2 at positions 0,1; or the step row at pos) -> logits of head j at row M-1 */
  cpPass(xbuf, M, pos, head) {
    const g = this.g, eps = this.cfg.talker.rms_eps || 1e-6, cg = this.h.cg;
    this.h.cp.forEach((sh, i) => {
      gemv(g, { w: this.W(sh, 'qkv'), x: { buf: xbuf, ld: D }, M, N: QKV, K: D, y: { buf: this.qkv, ld: QKV }, epi: 'store', norm: { buf: sh.buf, off: this.F(sh, 'ln1'), eps } });
      qkrope(g, { qkv: { buf: this.qkv, ld: QKV }, M, Hq: HQ, Hkv: HKV, D: HD, pos0: pos, q: { buf: this.q, ld: HQ * HD }, kc: { buf: this.cpK[i] }, vc: { buf: this.cpV[i] }, Lmax: 16,
        norm: { buf: sh.buf, q: this.F(sh, 'qn'), k: this.F(sh, 'kn'), eps }, rope: { buf: this.rope, sinOff: this.ropeSin } });
      attn(g, { q: { buf: this.q, ld: HQ * HD }, M, Hq: HQ, Hkv: HKV, D: HD, pos0: pos, window: 0, Lmax: 16, kc: { buf: this.cpK[i] }, vc: { buf: this.cpV[i] }, o: { buf: this.o, ld: HQ * HD } });
      gemv(g, { w: this.W(sh, 'o'), x: { buf: this.o, ld: HQ * HD }, M, N: D, K: HQ * HD, y: { buf: xbuf, ld: D }, epi: 'add' });
      gemv(g, { w: this.W(sh, 'gu'), x: { buf: xbuf, ld: D }, M, N: MLP, K: D, y: { buf: this.hm, ld: MLP }, epi: 'swiglu', rowOff: 0, wr1: MLP, norm: { buf: sh.buf, off: this.F(sh, 'ln2'), eps } });
      gemv(g, { w: this.W(sh, 'down'), x: { buf: this.hm, ld: MLP }, M, N: D, K: MLP, y: { buf: xbuf, ld: D }, epi: 'add' });
    });
    rmsrow(g, { x: { buf: xbuf, off: (M - 1) * D }, M: 1, K: D, w: { buf: cg.buf, off: this.F(cg, 'norm') }, eps, y: { buf: this.hn } });
    gemv(g, { w: this.W(cg, 'heads'), x: { buf: this.hn }, M: 1, N: 2048, K: D, rowOff: head * 2048, y: { buf: this.logits }, epi: 'store' });
  }

  /**
   * the frame loop.  o = { codes: GPU buffer u32 [maxFrames*16] (forced codes pre-filled when mode 'forced'), maxFrames, mode: 'sample'|'greedy'|'forced',
   *   sampling: {temperature, top_k, repetition_penalty, subtalker_temperature, subtalker_top_k}, seed, tt: GPU buffer [Ttr+1][1024] (last row = tts_pad),
   *   Ttr, ids: {eos}, logLogits: GPU buffer | null (forced tests: [frame][3072 + 15*2048] f32), check(), onFrame(k), stopAt }
   * returns the number of frames before EOS (the EOS frame excluded), or maxFrames.
   */
  async generate(o) {
    const g = this.g, sp = o.sampling || {}, cg = this.h.cg, tg = this.h.tg, EOS = o.ids.eos;
    const cemb = this.W(tg, 'codec_emb'), pemb = this.W(cg, 'emb');
    const mode = o.mode || 'sample', cpMode = mode === 'sample' && sp.subtalker_dosample === false ? 'greedy' : mode;
    const seed = [o.seed >>> 0, Math.imul((o.seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0];
    g.device.queue.writeBuffer(this.seen, 0, new Uint32Array(128));
    const LOGW = 3072 + 15 * 2048, ring = this.ring, RING = 4; let eosAt = -1, done = 0;
    for (const r of ring) { r.k = -1; r.p = null; }
    // probes v002: the runner's uniform ring holds 3 sets of 16 (one per frame in flight) before the first frame, so frame k and frame k-3
    // meet the same uniform buffers + slots from the start and every bind group after the first 3 frames comes from the cache
    const RN = g.runner; while (RN.pool.length < 48) { RN.ri = RN.pool.length; RN._ub(); }
    const poll = async (k) => {   // wait for frame k's code-0 readback
      const r = ring[k % RING]; if (r.k !== k) return; await r.p; const v = new Uint32Array(r.buf.getMappedRange(0, 16))[0]; r.buf.unmap(); r.k = -1; r.p = null;
      if (v === EOS && eosAt < 0) eosAt = k;
    };
    try {
      for (let k = 0; k < o.maxFrames; k++) {
        if (o.check) o.check();
        // probes v002: frame k takes its uniform buffers from set k % 3 of the runner's ring (frame k-3 has finished: its EOS readback
        // was awaited), so the same dispatches meet the same buffers + slots and their bind groups come from the cache
        const base = (k % 3) * 16;
        for (let i = base; i < base + 16; i++) RN.pool[i]._busy = false;   // frame k-3's work is done: its EOS readback was awaited
        RN.ri = base;
        const p = this.pos + k;
        if (k > 0) g.runner.copy(this.state, D * 4, this.xr, 0, D * 4);     // next input = the running embedding sum (state row 1)
        if (k > 0) this.step(p - 1 + 0);
        // talker code 0 (frame k): the logits of the last talker pass (prefill for k = 0)
        if (o.logLogits) g.runner.copy(this.logits, 0, o.logLogits, k * LOGW * 4, 3072 * 4);
        sampler(g, { logits: { buf: this.logits }, V: 3072, mode, temperature: sp.temperature || 0.9, topk: sp.top_k || 50, penalty: sp.repetition_penalty || 1.05,
          seen: { buf: this.seen }, suppress: [2048, 3072], eos: EOS, maskEos: k < 2, seed, ctr: k * 16, codes: { buf: o.codes }, codeIdx: k * 16,
          emb: { buf: cemb.buf, off: cemb.off / 2 }, state: { buf: this.cpIn }, dstOff: D, sum: null });
        // the running sum starts as codec_emb(code0)  (state row 1); code-predictor prefill on [hn, codec_emb(code0)]
        g.runner.copy(this.cpIn, D * 4, this.state, D * 4, D * 4);
        this.cpPass(this.cpIn, 2, 0, 0);
        for (let j = 1; j <= 15; j++) {
          if (o.logLogits) g.runner.copy(this.logits, 0, o.logLogits, (k * LOGW + 3072 + (j - 1) * 2048) * 4, 2048 * 4);
          const last = j === 15;
          sampler(g, { logits: { buf: this.logits }, V: 2048, mode: cpMode, temperature: sp.subtalker_temperature || 0.9, topk: sp.subtalker_top_k || 50, penalty: 1,
            seed, ctr: k * 16 + j, codes: { buf: o.codes }, codeIdx: k * 16 + j, emb: { buf: pemb.buf, off: (pemb.off / 2) + (j - 1) * 2048 * D },
            state: { buf: this.state }, dstOff: last ? -1 : 0, sum: 'add', sumOff: D, textRow: last ? Math.min(k, o.Ttr) : -1, tt: o.tt.buf ? o.tt : { buf: o.tt } });
          if (!last) this.cpPass(this.state, 1, j + 1, j);
        }
        // code-0 readback ring (EOS) - the GPU keeps working while the CPU waits for an older frame
        const r = ring[k % RING]; if (r.k >= 0) await poll(r.k);
        g.runner.copy(o.codes, k * 64, r.buf, 0, 16); g.runner.flush();
        r.k = k; r.p = r.buf.mapAsync(GPUMapMode.READ);
        if (k >= 2) await poll(k - 2);
        if (o.onFrame) o.onFrame(k);
        done = k + 1;
        if (eosAt >= 0) break;
        if (o.stopAt != null && k + 1 >= o.stopAt) break;
      }
      for (let k = Math.max(0, done - RING); k < done; k++) await poll(k);
    } finally { g.runner.flush(); await g.device.queue.onSubmittedWorkDone(); g.runner.sync(); for (const r of ring) { if (r.p) { try { await r.p; r.buf.unmap(); } catch (e) { /* */ } } r.k = -1; r.p = null; } }
    this.pos += done;
    return { frames: eosAt >= 0 ? eosAt : done, eos: eosAt >= 0, ran: done };
  }
}
