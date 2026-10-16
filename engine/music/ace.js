// ACE-Step 1.5 turbo networks on the p0pc0rn engine core (music probe, module 'music-0.1').  Spec: ACESTEP15_TURBO_SPEC.md.
//   AceText   Qwen3-Embedding-0.6B: prompt -> 28 causal Qwen3 layers -> final RMSNorm -> text_projector (1024 -> 2048) ; lyric token rows
//   AceLyric  lyric encoder: embed_tokens (1024 -> 2048, bias) -> 8 bidirectional layers (even layers: sliding window 128) -> RMSNorm
//   AceDiT    condition_embedder over [lyrics | timbre const | text] -> per-layer cross K/V (once per song) -> 24 DiT layers x 8 steps
//   AceVae    Oobleck decoder (64 -> 2 x 48 kHz, x1920), weights resident, time tiles with an exact halo (receptive field ~9 frames)
// Residual streams fp32, fp32 RMS statistics, every GEMM input f16 with in-kernel dequant (q8g64s / q4g32a / f16).  Shards are
// streamed one at a time (new GPU buffer per shard, destroyed after use); the next shard's upload overlaps the current GPU work.
'use strict';
import { gemm } from '../ops/gemm.js';
import { rowstats } from '../ops/misc.js';
import { ropeTE } from '../models/klein_blocks.js';
import { buildTokenizer } from '../models/tokenizer.js';
import { toF16 } from '../core/gpu.js';
import { agemm } from '../audio/agemm.js';
import { mattention } from './mattn.js';
import { rmsapply16, cast16, snake } from './mops.js';

export const MUSIC_VERSION = 'music-0.2';
export const EOS = 151643;
export const DEFAULT_INSTRUCTION = 'Fill the audio semantic mask based on the given conditions:';
const pad2 = (i) => String(i).padStart(2, '0');
/** tensor of a shard handle: '<shard>/<name>' or a global name */
const tt = (sh, n) => { try { return sh.t(sh.name + '/' + n); } catch (e) { return sh.t(n); } };
const idRope = (rows) => { const o = new Float32Array(rows * 128); for (let i = 0; i < o.length; i += 2) o[i] = 1; return o; };

/** SFT_GEN_PROMPT + metas (constants.py, metadata_utils.py) and the lyric block (prompt_utils._format_lyrics), exactly */
export function formatPrompt({ tags, bpm, keyscale, timesignature, seconds, instruction }) {
  const na = (v) => (v == null || String(v).trim() === '' ? 'N/A' : String(v).trim());
  const metas = `- bpm: ${na(bpm)}\n- timesignature: ${na(timesignature)}\n- keyscale: ${na(keyscale)}\n- duration: ${Math.trunc(seconds)} seconds\n`;
  let ins = instruction || DEFAULT_INSTRUCTION; if (!ins.endsWith(':')) ins += ':';
  return `# Instruction\n${ins}\n\n# Caption\n${tags}\n\n# Metas\n${metas}<|endoftext|>\n`;
}
export const formatLyrics = (lyrics, language = 'en') => `# Languages\n${language}\n\n# Lyric\n${lyrics}<|endoftext|>`;

// ------------------------------------------------------------------ one Qwen3-style layer (TE and lyric encoder)
// s = {x f32 [T][HD], T, stats, heads f16 [Hq+2Hkv][T][128], o f16 [T][Hq*128], m f16 [T][MLP], rope, acc}
function qwenLayer(g, sh, s, c, mode, nvalid) {
  const T = s.T, HD = c.HD, NQ = c.Hq * 128, ln1 = tt(sh, 'ln1'), ln2 = tt(sh, 'ln2'), qkn = tt(sh, 'qk_norm');
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: tt(sh, 'qkv'), x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln1.off / 4 }, M: T, N: NQ + 2 * c.Hkv * 128, K: HD,
    epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: qkn.off / 4 }, heads: { Ltot: T, Hq: c.Hq, Hkv: c.Hkv, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.rope } } });
  mattention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: c.Hq * T * 256 }, v: { buf: s.heads, off: (c.Hq + c.Hkv) * T * 256 },
    o: { buf: s.o, ld: NQ }, Lq: T, Lk: T, Hq: c.Hq, Hkv: c.Hkv, mode, nvalid, cfg: g.tune && g.tune.attn });
  gemm(g, { acc: s.acc, w: tt(sh, 'o'), x: { buf: s.o, ld: NQ }, M: T, N: HD, K: NQ, epi: 'resadd', y: { buf: s.x, ld: HD } });
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: tt(sh, 'gate_up'), x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln2.off / 4 }, M: T, N: 2 * c.MLP, K: HD,
    wr0: 0, wr1: c.MLP, epi: 'swiglu', y: { buf: s.m, ld: c.MLP } });
  gemm(g, { acc: s.acc, w: tt(sh, 'down'), x: { buf: s.m, ld: c.MLP }, M: T, N: HD, K: c.MLP, epi: 'resadd', y: { buf: s.x, ld: HD } });
}
const qwenScratch = (g, T, c, tag) => ({ T, stats: g.buffer(T * 8, tag + '.stats'), heads: g.buffer((c.Hq + 2 * c.Hkv) * T * 256, tag + '.heads'),
  o: g.buffer(T * c.Hq * 128 * 2, tag + '.o'), m: g.buffer(T * c.MLP * 2, tag + '.m'), rope: g.upload(ropeTE(T), tag + '.rope') });
const freeAll = (g, s, keys) => { for (const k of keys) if (s[k]) { g.free(s[k]); s[k] = null; } };

/** stream shards names[0..n) through fn(sh, i); the next upload overlaps the current GPU work (Klein TE pattern) */
async function streamShards(g, st, names, fn, check) {
  let sh = await st.upload(names[0]);
  try {
    for (let i = 0; i < names.length; i++) {
      fn(sh, i);
      g.runner.flush();
      const done = g.device.queue.onSubmittedWorkDone();
      st.release(sh); sh = null;
      if (i + 1 < names.length) sh = await st.upload(names[i + 1]);
      await done;
      if (check) check();
    }
  } finally { if (sh) st.release(sh); }
}

// ------------------------------------------------------------------ text encoder (Qwen3-Embedding-0.6B) + lyric token rows
export class AceText {
  constructor(g, store) { this.g = g; this.st = store; this.tok = null; this.c = { HD: 1024, Hq: 16, Hkv: 8, MLP: 3072 }; }
  async tokenizer() {
    if (this.tok) return this.tok;
    const d = new TextDecoder(), rd = async (n) => d.decode(await this.st.readFile(n));
    this.tok = buildTokenizer(JSON.parse(await rd('tokenizer.vocab')), await rd('tokenizer.merges'), JSON.parse(await rd('tokenizer.tokenizer_config')));
    return this.tok;
  }
  /** HF fast tokenizer of Qwen3-Embedding: BPE (added tokens split first) + TemplateProcessing appends <|endoftext|>; truncation keeps max-1 + EOS */
  async ids(text, max) {
    const tok = await this.tokenizer(); let ids = Array.from(tok.encode(text, { add_special_tokens: false }).ids);
    const truncated = ids.length > max - 1; if (truncated) ids = ids.slice(0, max - 1);
    ids.push(EOS); return { ids, truncated };
  }
  /** token embedding rows (q8 rows, dequantised in JS) -> Float32Array [n][1024] */
  async rows(ids) {
    const uniq = Array.from(new Set(ids)), rows = await this.st.readRows('te.embed_tokens', uniq), where = new Map(uniq.map((id, i) => [id, i]));
    const out = new Float32Array(ids.length * 1024);
    for (let t = 0; t < ids.length; t++) out.set(rows.subarray(where.get(ids[t]) * 1024, (where.get(ids[t]) + 1) * 1024), t * 1024);
    return out;
  }
  /** prompt ids -> writes text_projector(norm(TE(ids))) as f16 rows into y = {buf, off(bytes), ld = 2048}.  opts {check, onLayer, keepX} */
  async encode(ids, y, opts = {}) {
    const g = this.g, st = this.st, T = ids.length, c = this.c;
    const s = Object.assign(qwenScratch(g, T, c, 'te'), { acc: 'f32', x: g.upload(await this.rows(ids), 'te.x') });
    try {
      await streamShards(g, st, Array.from({ length: 28 }, (_, i) => 'te.layer.' + pad2(i)), (sh, l) => { qwenLayer(g, sh, s, c, 1, T); if (opts.onLayer) opts.onLayer(l); }, opts.check);
      const fin = await st.upload('te.final');
      try {
        rowstats(g, { x: { buf: s.x }, rows: T, cols: 1024, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
        gemm(g, { acc: 'f32', w: tt(fin, 'text_projector'), x: { buf: s.x, ld: 1024, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: fin.buf, off: tt(fin, 'te.norm').off / 4 },
          M: T, N: 2048, K: 1024, epi: 'f16', y: { buf: y.buf, off: y.off || 0, ld: 2048 } });
        if (opts.keepX) { const r = await g.read(s.x); opts.keepX(new Float32Array(r)); }
        await g.done();
      } finally { st.release(fin); }
    } finally { freeAll(g, s, ['x', 'stats', 'heads', 'o', 'm', 'rope']); }
  }
}

// ------------------------------------------------------------------ lyric encoder
export class AceLyric {
  constructor(g, store) { this.g = g; this.st = store; this.c = { HD: 2048, Hq: 16, Hkv: 8, MLP: 6144 }; }
  /** rows Float32Array [L][1024] (TE embedding rows of the lyric ids) -> f16 rows norm(enc(...)) into y = {buf, off(bytes), ld 2048} */
  async encode(rows, L, y, opts = {}) {
    const g = this.g, st = this.st, c = this.c;
    const s = Object.assign(qwenScratch(g, L, c, 'lyr'), { acc: opts.acc || 'f32', x: g.buffer(L * 2048 * 4, 'lyr.x') });
    const e16 = g.upload(toF16(rows), 'lyr.in');
    let em = null;
    try {
      em = await st.upload('lyr.embed');
      gemm(g, { acc: s.acc, w: tt(em, 'lyr.embed_tokens'), x: { buf: e16, ld: 1024 }, M: L, N: 2048, K: 1024, epi: 'resadd', store: true,
        bv: { buf: em.buf, off: tt(em, 'lyr.embed_tokens.bias').off / 4 }, y: { buf: s.x, ld: 2048 } });
      g.runner.flush();
      await streamShards(g, st, Array.from({ length: 8 }, (_, i) => 'lyr.layer.' + i), (sh, l) => { qwenLayer(g, sh, s, c, l % 2 === 0 ? 3 : 0, l % 2 === 0 ? 128 : L); if (opts.onLayer) opts.onLayer(l); }, opts.check);
      rowstats(g, { x: { buf: s.x }, rows: L, cols: 2048, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
      rmsapply16(g, { x: { buf: s.x, ld: 2048 }, stats: { buf: s.stats }, w: { buf: em.buf, off: tt(em, 'lyr.norm').off / 4 }, y: { buf: y.buf, off: (y.off || 0) / 2, ld: 2048 }, rows: L, C: 2048 });
      if (opts.keepX) { const r = await g.read(s.x); opts.keepX(new Float32Array(r)); }
      await g.done();
    } finally { if (em) st.release(em); g.free(e16); freeAll(g, s, ['x', 'stats', 'heads', 'o', 'm', 'rope']); }
  }
}

// ------------------------------------------------------------------ DiT
export class AceDiT {
  constructor(g, store) { this.g = g; this.st = store; this.kv = []; this.c = null; }
  /** dit.const -> JS tables (modulation tables, norms, time embeddings) + a small resident GPU part (proj_in / proj_out / cond_emb) */
  async loadConst() {
    if (this.c) return this.c;
    const st = this.st, T = st.m.tensors, f32 = async (n) => {
      const x = T[n], s = st.shards.get(x.shard);
      const ab = st.http ? await st._range(s.file, x.offset, x.bytes) : (await st.st.call('read', { name: `${st.dir}/${s.file}`, at: x.offset, len: x.bytes })).buf;
      return new Float32Array(ab.slice(0, x.bytes));
    };
    const c = { lss: await f32('dit.const/layer_scale_shift'), lnorm: await f32('dit.const/layer_norms'), oss: await f32('dit.const/out_scale_shift'),
      onorm: await f32('dit.const/norm_out'), temb: await f32('dit.const/time.temb'), tproj: await f32('dit.const/time.proj'), tvals: await f32('dit.const/time.t'),
      sil: await f32('dit.const/silence_latent'), timbre: await f32('dit.const/timbre_const') };
    c.tmax = c.sil.length / 64;
    this.c = c; return c;
  }
  /** index of t in the precomputed time tables (the turbo sampler maps every schedule to its 20 VALID_TIMESTEPS) */
  tIndex(t) { const v = this.c.tvals; let b = 0; for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - t) < Math.abs(v[b] - t)) b = i; return b; }
  /** modulation buffer for timestep t: per layer [S1 B1 G1 S3 B3 G3] (S = w * (1 + scale) - 1, B = shift), then [S_out B_out] */
  modulation(t) {
    const c = this.c, k = this.tIndex(t), D = 2048, out = new Float32Array(24 * 6 * D + 2 * D), P = c.tproj.subarray(k * 6 * D, (k + 1) * 6 * D);
    for (let l = 0; l < 24; l++) {
      const tb = c.lss.subarray(l * 6 * D), w1 = c.lnorm.subarray((l * 2) * D), w3 = c.lnorm.subarray((l * 2 + 1) * D), o = l * 6 * D;
      for (let i = 0; i < D; i++) {
        const sh0 = tb[i] + P[i], sc0 = tb[D + i] + P[D + i], g0 = tb[2 * D + i] + P[2 * D + i];
        const sh1 = tb[3 * D + i] + P[3 * D + i], sc1 = tb[4 * D + i] + P[4 * D + i], g1 = tb[5 * D + i] + P[5 * D + i];
        out[o + i] = w1[i] * (1 + sc0) - 1; out[o + D + i] = sh0; out[o + 2 * D + i] = g0;
        out[o + 3 * D + i] = w3[i] * (1 + sc1) - 1; out[o + 4 * D + i] = sh1; out[o + 5 * D + i] = g1;
      }
    }
    const te = c.temb.subarray(k * D, (k + 1) * D), o = 24 * 6 * D;
    for (let i = 0; i < D; i++) { const shift = c.oss[i] + te[i], scale = c.oss[D + i] + te[i]; out[o + i] = c.onorm[i] * (1 + scale) - 1; out[o + D + i] = shift; }
    return out;
  }
  /** conditioning: Ein f16 [Lenc][2048] (rows: lyrics | timbre | text, filled by the caller except the timbre row) -> E = cond_emb(Ein) + b
   *  -> cross K/V per layer (k_norm, no RoPE): kv[l] f16 [16 heads (8 K | 8 V)][Lenc][128].  Ein is freed. */
  async prepare(Ein, Ll, Lenc, opts = {}) {
    const g = this.g, st = this.st; await this.loadConst();
    g.upload(toF16(this.c.timbre), 'timbre', Ein, Ll * 2048 * 2);
    const E = g.buffer(Lenc * 2048 * 2, 'dit.E'), idr = g.upload(idRope(Math.max(Lenc, 8)), 'dit.idrope');
    const cs = await this.constants();   // p0pc0rn v024.2: kept until freeState (it was uploaded and destroyed twice per step)
    try {
      gemm(g, { acc: 'f32', w: tt(cs, 'cond_emb'), x: { buf: Ein, ld: 2048 }, M: Lenc, N: 2048, K: 2048, epi: 'bias', ev: { buf: cs.buf, off: tt(cs, 'cond_emb.bias').off / 4 }, y: { buf: E, ld: 2048 } });
      g.runner.flush(); await g.done();
    } finally { g.free(Ein); }
    this.freeKV();
    try {
      await streamShards(g, st, Array.from({ length: 24 }, (_, i) => 'dit.xkv.' + pad2(i)), (sh, l) => {
        const kv = g.buffer(16 * Lenc * 256, 'dit.kv' + l); this.kv.push(kv);
        gemm(g, { acc: opts.acc || 'f32', w: tt(sh, 'kv'), x: { buf: E, ld: 2048 }, M: Lenc, N: 2048, K: 2048, epi: 'heads', y: { buf: kv }, ev: { buf: sh.buf, off: tt(sh, 'cross_qk_norm').off / 4 },
          heads: { Ltot: Lenc, Hq: 0, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: idr } } });
      }, opts.check);
      if (opts.keepE) { const r = await g.read(E); opts.keepE(new Uint16Array(r)); }
    } finally { g.free(E); g.free(idr); }
    this.Lenc = Lenc;
  }
  freeKV() { this.g.runner.flush(); for (const b of this.kv) this.g.free(b); this.kv = []; }
  /** p0pc0rn v024.2: the DiT's constants (proj_in / proj_out / cond_emb) on the GPU once per song, released in freeState() */
  async constants() { if (!this.cs) this.cs = await this.st.upload('dit.const'); return this.cs; }
  /** per-song GPU state: staging S16 [Tpad][192] (ctx = silence latent | chunk mask 1.0 ; x), residual, scratch, rope tables */
  /** hints: optional Float32Array [>= T][64] (the 5 Hz LM's detokenised 25 Hz hints) replacing the silence latent in the context */
  alloc(T, hints = null) {
    const g = this.g, c = this.c, Tp = Math.ceil(T / 2), Tpad = 2 * Tp;
    if (T > c.tmax) throw Object.assign(new Error(`song longer than the pack's silence latent (${c.tmax / 25} s)`), { code: 'BAD_SIZE' });
    const S = new Float32Array(Tpad * 192), nh = hints ? Math.min(T, hints.length / 64) : 0;
    for (let r = 0; r < T; r++) { S.set(r < nh ? hints.subarray(r * 64, r * 64 + 64) : c.sil.subarray(r * 64, r * 64 + 64), r * 192); for (let j = 64; j < 128; j++) S[r * 192 + j] = 1; }
    this.s = { T, Tp, Tpad, S16: g.upload(toF16(S), 'dit.S16'), x: g.buffer(Tp * 2048 * 4, 'dit.x'), stats: g.buffer(Tp * 8, 'dit.stats'),
      heads: g.buffer(32 * Tp * 256, 'dit.heads'), cq: g.buffer(16 * Tp * 256, 'dit.cq'), o: g.buffer(Tp * 2048 * 2, 'dit.o'), m: g.buffer(Tp * 6144 * 2, 'dit.m'),
      rope: g.upload(ropeTE(Tp), 'dit.rope'), idr: g.upload(idRope(Tp), 'dit.idr'), mod: g.buffer((24 * 6 + 2) * 2048 * 4, 'dit.mod'),
      xt: g.buffer(Tpad * 64 * 4, 'dit.xt'), v: g.buffer(Tpad * 64 * 4, 'dit.v') };
    return this.s;
  }
  freeState() { this.g.runner.flush(); if (this.cs) { this.st.release(this.cs); this.cs = null; } if (this.s) { for (const k of ['S16', 'x', 'stats', 'heads', 'cq', 'o', 'm', 'rope', 'idr', 'mod', 'xt', 'v']) this.g.free(this.s[k]); this.s = null; } }
  /** set x_t (Float32Array [T][64]) on the GPU: xt (f32) and the staging columns 128..191 */
  setX(x) {
    const g = this.g, s = this.s; g.upload(x, 'xt', s.xt, 0);
    const tmp = g.upload(x, 'xt.tmp'); cast16(g, { x: { buf: tmp, ld: 64 }, y: { buf: s.S16, off: 128, ld: 192 }, rows: s.T, C: 64 }); g.runner.flush();
    g.device.queue.onSubmittedWorkDone().then(() => g.free(tmp));
  }
  /** one DiT pass at timestep t: v = DiT(x_t, t) -> s.v (f32 [Tpad][64]).  opts {acc, check, onLayer, taps: {layer: fn(Float32Array)}} */
  async forward(t, opts = {}) {
    const g = this.g, st = this.st, s = this.s, Tp = s.Tp, D = 2048, acc = opts.acc || (g.tune && g.tune.acc) || 'f32';
    g.upload(this.modulation(t), 'mod', s.mod, 0);
    const cs = await this.constants();
    gemm(g, { acc, w: tt(cs, 'proj_in'), x: { buf: s.S16, ld: 384 }, M: Tp, N: D, K: 384, epi: 'resadd', store: true, bv: { buf: cs.buf, off: tt(cs, 'proj_in.bias').off / 4 }, y: { buf: s.x, ld: D } });
    g.runner.flush(); await g.done();
    const Lenc = this.Lenc, taps = opts.taps || {};
    const pending = [];
    await streamShards(g, st, Array.from({ length: 24 }, (_, i) => 'dit.layer.' + pad2(i)), (sh, l) => {
      const mo = l * 6 * D;
      rowstats(g, { x: { buf: s.x }, rows: Tp, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
      gemm(g, { acc, w: tt(sh, 'qkv'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: mo, stride: D }, M: Tp, N: 4096, K: D,
        epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: tt(sh, 'qk_norm').off / 4 }, heads: { Ltot: Tp, Hq: 16, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.rope } } });
      mattention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: 16 * Tp * 256 }, v: { buf: s.heads, off: 24 * Tp * 256 }, o: { buf: s.o, ld: D },
        Lq: Tp, Lk: Tp, Hq: 16, Hkv: 8, mode: l % 2 === 0 ? 3 : 0, nvalid: l % 2 === 0 ? 128 : Tp, cfg: g.tune && g.tune.attn });
      gemm(g, { acc, w: tt(sh, 'o'), x: { buf: s.o, ld: D }, M: Tp, N: D, K: D, epi: 'resadd', ev: { buf: s.mod, off: mo + 2 * D }, y: { buf: s.x, ld: D } });
      rowstats(g, { x: { buf: s.x }, rows: Tp, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
      gemm(g, { acc, w: tt(sh, 'cross_q'), x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: tt(sh, 'cross_norm').off / 4 }, M: Tp, N: D, K: D,
        epi: 'heads', y: { buf: s.cq }, ev: { buf: sh.buf, off: tt(sh, 'cross_qk_norm').off / 4 }, heads: { Ltot: Tp, Hq: 16, Hkv: 0, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.idr } } });
      mattention(g, { q: { buf: s.cq, off: 0 }, k: { buf: this.kv[l], off: 0 }, v: { buf: this.kv[l], off: 8 * Lenc * 256 }, o: { buf: s.o, ld: D },
        Lq: Tp, Lk: Lenc, Hq: 16, Hkv: 8, mode: 0, nvalid: Lenc, cfg: g.tune && g.tune.attn });
      gemm(g, { acc, w: tt(sh, 'cross_o'), x: { buf: s.o, ld: D }, M: Tp, N: D, K: D, epi: 'resadd', y: { buf: s.x, ld: D } });
      rowstats(g, { x: { buf: s.x }, rows: Tp, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
      gemm(g, { acc, w: tt(sh, 'gate_up'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: mo + 3 * D, stride: D }, M: Tp, N: 12288, K: D,
        wr0: 0, wr1: 6144, epi: 'swiglu', y: { buf: s.m, ld: 6144 } });
      gemm(g, { acc, w: tt(sh, 'down'), x: { buf: s.m, ld: 6144 }, M: Tp, N: D, K: 6144, epi: 'resadd', ev: { buf: s.mod, off: mo + 5 * D }, y: { buf: s.x, ld: D } });
      if (taps[l]) pending.push(g.read(s.x).then((r) => taps[l](new Float32Array(r))));
      if (opts.onLayer) opts.onLayer(l);
    }, opts.check);
    await Promise.all(pending);
    const cs2 = await this.constants();
    {
      rowstats(g, { x: { buf: s.x }, rows: Tp, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
      gemm(g, { acc, w: tt(cs2, 'proj_out'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: 24 * 6 * D, stride: D }, M: Tp, N: 128, K: D,
        epi: 'resadd', store: true, bv: { buf: cs2.buf, off: tt(cs2, 'proj_out.bias').off / 4 }, y: { buf: s.v, ld: 128 } });
      g.runner.flush(); await g.done();
    }
  }
}
export const ditStepFlops = (T, Lenc) => { const Tp = Math.ceil(T / 2); return 24 * 2 * Tp * (2048 * 4096 + 3 * 2048 * 2048 + 3 * 2048 * 6144) + 12 * 4 * Tp * Math.min(Tp, 257) * 2048 + 12 * 4 * Tp * Tp * 2048 + 24 * 4 * Tp * Lenc * 2048; };

// ------------------------------------------------------------------ Oobleck VAE decoder
const STR = [10, 6, 4, 4, 2], CH = [2048, 1024, 512, 256, 128, 128], HALO = 12;
export const vaeFlopsPerFrame = (() => { let v = 2 * 64 * 2048 * 7, r = 1; for (let b = 0; b < 5; b++) { r *= STR[b]; const ci = CH[b], co = CH[b + 1]; v += r * 4 * ci * co + r * 6 * (co * co * 8); } return v + r * 2 * 128 * 2 * 7; })();
/** peak bytes of one tile of n latent frames (block-4 residual f32 + two f16 temps + the block-3 f16 input) */
export const vaeTileBytes = (n) => n * 1920 * 128 * (4 + 2 + 2) + n * 960 * 128 * 2 + n * 2048 * 6;

export class AceVae {
  constructor(g, store) { this.g = g; this.st = store; this.sh = null; }
  async load() {
    if (this.sh) return;
    this.sh = {};
    for (const n of ['vae.in', 'vae.block.0', 'vae.block.1', 'vae.block.2', 'vae.block.3', 'vae.block.4', 'vae.out']) this.sh[n] = await this.st.upload(n);
  }
  unload() { this.freeArena(); if (this.sh) for (const k in this.sh) this.st.release(this.sh[k]); this.sh = null; }
  /** p0pc0rn v024.2: the decoder's working set for parts of up to nMax latent rows, allocated ONCE and reused by every part
   *  (WebKit gave the ~173 MB that each part created and destroyed back too late: Josh's iPhone died at part 7 of 24).
   *  F (f32): each stage's input / output stream; B1 (f16): the snake activations; B2: the residual units' hidden, then the waveform.
   *  In every dispatch the source and the destination are different buffers, and a stage's input is consumed before its output lands. */
  arena(nMax) {
    if (this.ar && this.ar.n >= nMax) return this.ar;
    this.freeArena();
    let T = nMax, f = nMax * 2048 * 4, a = 0, h = 0;
    for (let b = 0; b < 5; b++) { const Ci = CH[b], Co = CH[b + 1], To = T * STR[b]; a = Math.max(a, T * Ci * 2, To * Co * 2); f = Math.max(f, To * Co * 4); h = Math.max(h, To * Co * 2); T = To; }
    a = Math.max(a, T * 128 * 2); h = Math.max(h, T * 4 * 4);
    const g = this.g; this.ar = { n: nMax, F: g.buffer(f, 'vae.F'), B1: g.buffer(a, 'vae.B1'), B2: g.buffer(h, 'vae.B2') };
    return this.ar;
  }
  freeArena() { if (!this.ar) return; this.g.runner.flush(); for (const k of ['F', 'B1', 'B2']) this.g.free(this.ar[k]); this.ar = null; }
  get weightBytes() { let b = 0; for (const k in this.sh || {}) b += this.sh[k].bytes; return b; }
  /** latent rows [z0, z0 + n) of z (f16 [T][64], GPU) -> waveform f32 [n*1920][4] (cols 0, 1 = L, R) in the arena's B2 (v024.2: the
   *  caller reads it before the next part and never frees it; nothing is allocated or destroyed per part).
   *  Zero padding at the tile edges, exactly like each chunk of the official tiled_decode.  acc 'f16'|'f32' */
  decodeTile(z, z0, n, acc = 'f32') {
    const g = this.g, S = this.sh, a = (name, sh) => tt(sh, name), R = this.arena(n);
    const conv = (sh, name, x, Tin, Ci, N, dil, out, epi, extra = {}) => {
      const w = a(name, sh), K = Math.ceil(7 * Ci / 32) * 32;
      agemm(g, Object.assign({ acc, w, x: { buf: x }, M: Tin, N, K, conv: { kind: 'conv', Tin, Tout: Tin, Ci, dil, pad: 3 * dil, Kreal: 7 * Ci }, epi, y: { buf: out, ld: N } }, extra));
    };
    // conv1 64 -> 2048 (k7), f32 stream
    let X = R.F;
    { const w = a('conv1', S['vae.in']);
      agemm(g, { acc, w, x: { buf: z }, M: n, N: 2048, K: 448, conv: { kind: 'conv', Tin: n, Tout: n, Ci: 64, dil: 1, pad: 3, Kreal: 448, xRB: 0, xR0: z0 }, epi: 'f32',
        bv: { buf: S['vae.in'].buf, off: a('conv1.bias', S['vae.in']).off / 4 }, y: { buf: X, ld: 2048 } }); }
    let T = n;
    for (let b = 0; b < 5; b++) {
      const sh = S['vae.block.' + b], u = STR[b], Ci = CH[b], Co = CH[b + 1], To = T * u;
      const A = R.B1;
      snake(g, { x: { buf: X }, y: { buf: A }, prm: { buf: sh.buf }, aOff: a('snake1.alpha', sh).off / 4, bOff: a('snake1.invbeta', sh).off / 4, rows: T, C: Ci });
      const Y = R.F;   // X (also F) was consumed by the snake above
      agemm(g, { acc, w: a('up', sh), x: { buf: A }, M: T + 1, N: u * Co, K: 2 * Ci, conv: { kind: 'tconv', Tin: T, Ci, Kreal: 2 * Ci }, epi: 'f32',
        bv: { buf: sh.buf, off: a('up.bias', sh).off / 4 }, y: { buf: Y, ld: u * Co }, yNeg: (u / 2) * Co, yLim: To * Co });
      const H = R.B2, A2 = R.B1;   // A (B1) was consumed by the transposed conv
      for (const [j, d] of [[1, 1], [2, 3], [3, 9]]) {
        snake(g, { x: { buf: Y }, y: { buf: A2 }, prm: { buf: sh.buf }, aOff: a(`ru${j}.snake1.alpha`, sh).off / 4, bOff: a(`ru${j}.snake1.invbeta`, sh).off / 4, rows: To, C: Co });
        conv(sh, `ru${j}.conv1`, A2, To, Co, Co, d, H, 'f16', { bv: { buf: sh.buf, off: a(`ru${j}.conv1.bias`, sh).off / 4 } });
        snake(g, { x: { buf: H }, prm: { buf: sh.buf }, aOff: a(`ru${j}.snake2.alpha`, sh).off / 4, bOff: a(`ru${j}.snake2.invbeta`, sh).off / 4, rows: To, C: Co, src16: true });
        agemm(g, { acc, w: a(`ru${j}.conv2`, sh), x: { buf: H }, M: To, N: Co, K: Co, conv: { kind: 'conv', Tin: To, Tout: To, Ci: Co, dil: 1, pad: 0, Kreal: Co }, epi: 'add',
          bv: { buf: sh.buf, off: a(`ru${j}.conv2.bias`, sh).off / 4 }, y: { buf: Y, ld: Co } });
      }
      X = Y; T = To;
    }
    const so = S['vae.out'], A = R.B1;
    snake(g, { x: { buf: X }, y: { buf: A }, prm: { buf: so.buf }, aOff: a('snake1.alpha', so).off / 4, bOff: a('snake1.invbeta', so).off / 4, rows: T, C: 128 });
    const W = R.B2;
    conv(so, 'conv2', A, T, 128, 2, 1, W, 'f32', { y: { buf: W, ld: 4 } });
    return W;
  }
}
export { HALO as VAE_HALO };
