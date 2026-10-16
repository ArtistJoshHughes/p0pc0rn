// FLUX.2 VAE (SPEC 5): exact decoder and encoder on full fp16 HWC tensors (no tiling, no seams).  GroupNorm statistics are exact over
// the whole tensor (per-chunk two-pass + Chan merge); GN-apply + SiLU is fused into the consuming conv's prologue, nearest-2x into the
// conv's input indexing, residual adds into the conv epilogue (in place).  Above `bandAboveMB` the up_blocks.2 upsample output (472 MB
// at 720p) is never materialised: pass A computes it in row bands for the up_blocks.3.res0 GroupNorm statistics and the 1x1 shortcut,
// pass B recomputes each band with a 1-row halo and feeds conv1 (+12 % FLOPs, peak ~0.73 GB at 720p incl. the 99 MB of weights).
'use strict';
import { gemm } from '../ops/gemm.js';
import { gnPartial, gnFinalize, gnPartBytes, layout, convDirect, softmax, transpose16 } from '../ops/misc.js';

export const vaeDecodeFlops = (H, W) => 9.62e6 * H * W;
export const vaeEncodeFlops = (H, W) => 4.27e6 * H * W;

export class Flux2VAE {
  constructor(gpu, opts = {}) {
    this.g = gpu; this.bandRows = opts.bandRows || 64; this.bandAboveMB = opts.bandAboveMB != null ? opts.bandAboveMB : 200;
    this.qChunk = opts.qChunk || 1024; this.acc = 'f32';
  }
  drop(...bs) { this.g.runner.flush(); for (const b of bs) this.g.free(b); }

  conv(c, x, name, o) {
    const w = c.sh.t(name + '.weight'), b = c.sh.t(name + '.bias'), ks = w.shape[1], Ci = w.shape[3], Co = o.N || w.shape[0], K = ks * ks * Ci;
    const pad = o.stride === 2 ? 0 : ks >> 1;
    gemm(this.g, { w: { buf: w.buf, off: w.off, bytes: w.bytes, enc: 'f16', rows: w.shape[0], cols: K }, x: { buf: x, off: o.xOff || 0, size: o.xSize },
      M: o.Ho * o.Wo, N: Co, K, epi: 'bias', res: !!o.res, ev: { buf: c.sh.buf, off: b.off / 4 }, acc: this.acc,
      pv: o.gn != null ? { buf: c.ab, off: o.gn, stride: Ci } : null, y: { buf: o.y, off: o.yOff || 0 },
      conv: { Hi: o.Hi, Wi: o.Wi, Ci, Ho: o.Ho, Wo: o.Wo, stride: o.stride || 1, padT: o.padT != null ? o.padT : pad, padL: o.padL != null ? o.padL : pad, ks, up2: !!o.up2, gn: o.gn != null } });
  }
  gn(c, x, pix, C, name, slot) {
    const off = slot * 1024, nwg = gnPartial(this.g, { x: { buf: x }, pix, C, part: c.part });
    gnFinalize(this.g, { part: c.part, nwg, C, gb: { buf: c.sh.buf, gOff: c.sh.t(name + '.weight').off, bOff: c.sh.t(name + '.bias').off }, ab: { buf: c.ab, off }, eps: 1e-6 });
    return off;
  }
  res(c, x, p, Ci, Co, H, W) {
    const g = this.g, pix = H * W;
    const a1 = this.gn(c, x, pix, Ci, p + '.norm1', 0), h = g.buffer(pix * Co * 2, 'vae.h');
    this.conv(c, x, p + '.conv1', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a1, y: h });
    const a2 = this.gn(c, h, pix, Co, p + '.norm2', 1);
    let out = x;
    if (Ci !== Co) { out = g.buffer(pix * Co * 2, 'vae.s'); this.conv(c, x, p + '.conv_shortcut', { Hi: H, Wi: W, Ho: H, Wo: W, y: out }); this.drop(x); }
    this.conv(c, h, p + '.conv2', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a2, y: out, res: true });
    this.drop(h);
    return out;
  }
  attn(c, x, p, H, W) {   // single head, d = 512, query chunks: S = Q K^T (f32) -> softmax -> P (f16) -> P V
    const g = this.g, n = H * W, C = 512, Kp = Math.ceil(n / 32) * 32, sh = c.sh;
    const a = this.gn(c, x, n, C, p + '.group_norm', 0), hn = g.buffer(n * C * 2, 'vae.attn.hn');
    layout(g, { op: 'chanAffine', n: n * C, xh: { buf: x }, v: { buf: c.ab }, yh: { buf: hn }, a: C, f: a });
    const lin = (src, name, dst, res) => { const w = sh.t(name + '.weight'), b = sh.t(name + '.bias');
      gemm(g, { w: { buf: w.buf, off: w.off, bytes: w.bytes, enc: 'f16', rows: C, cols: C }, x: { buf: src, ld: C }, M: n, N: C, K: C, epi: 'bias', res: !!res,
        ev: { buf: sh.buf, off: b.off / 4 }, y: { buf: dst, ld: C }, acc: this.acc }); };
    const q = g.buffer(n * C * 2, 'vae.attn.q'), k = g.buffer(n * C * 2, 'vae.attn.k'), v = g.buffer(Kp * C * 2, 'vae.attn.v');
    lin(hn, p + '.to_q', q); lin(hn, p + '.to_k', k); lin(hn, p + '.to_v', v);
    this.drop(hn);
    const vt = g.buffer(C * Kp * 2, 'vae.attn.vt');
    transpose16(g, { x: { buf: v }, y: { buf: vt }, R: Kp, C });
    this.drop(v);
    const o = g.buffer(n * C * 2, 'vae.attn.o'), qc = Math.min(this.qChunk, n), S = g.buffer(qc * Kp * 4, 'vae.attn.S'), P = g.buffer(qc * Kp * 2, 'vae.attn.P');
    for (let r0 = 0; r0 < n; r0 += qc) {
      const m = Math.min(qc, n - r0);
      gemm(g, { w: { buf: k, off: 0, bytes: n * C * 2, enc: 'f16', rows: n, cols: C }, x: { buf: q, off: r0 * C * 2, ld: C }, M: m, N: n, K: C, epi: 'f32', y: { buf: S, ld: Kp }, acc: 'f32' });
      softmax(g, { s: { buf: S }, o: { buf: P }, rows: m, n, ld: Kp, scale: 1 / Math.sqrt(C) });
      gemm(g, { w: { buf: vt, off: 0, bytes: C * Kp * 2, enc: 'f16', rows: C, cols: Kp }, x: { buf: P, ld: Kp }, M: m, N: C, K: Kp, epi: 'f16', y: { buf: o, off: r0 * C * 2, ld: C }, acc: 'f32' });
    }
    this.drop(S, P, q, k, vt);
    lin(o, p + '.to_out.0', x, true);
    this.drop(o);
    return x;
  }
  upsample(c, x, name, H, W, C) {
    const y = this.g.buffer(4 * H * W * C * 2, 'vae.up');
    this.conv(c, x, name, { Hi: H, Wi: W, Ho: 2 * H, Wo: 2 * W, up2: true, y });
    this.drop(x);
    return y;
  }
  /** up_blocks.2 upsample fused with up_blocks.3.resnets.0 by row bands (see header).  y [Hs][Ws][256] -> [2Hs][2Ws][128] */
  async bandUp3(c, y, Hs, Ws, check) {
    const g = this.g, H = 2 * Hs, W = 2 * Ws, Ci = 256, Co = 128, B = this.bandRows, up = 'decoder.up_blocks.2.upsamplers.0.conv', p = 'decoder.up_blocks.3.resnets.0';
    const ub = g.buffer((B + 2) * W * Ci * 2, 'vae.band'), s = g.buffer(H * W * Co * 2, 'vae.s'), h = g.buffer(H * W * Co * 2, 'vae.h');
    const computeU = (a, b) => {
      const sr0 = Math.max(0, Math.floor((a - 1) / 2)), sr1 = Math.min(Hs, Math.floor(b / 2) + 1);
      this.conv(c, y, up, { Hi: sr1 - sr0, Wi: Ws, Ho: b - a, Wo: W, up2: true, padT: 2 * sr0 - a + 1, padL: 1, xOff: sr0 * Ws * Ci * 2, xSize: (sr1 - sr0) * Ws * Ci * 2, y: ub });
    };
    let nwg = 0;
    for (let r0 = 0; r0 < H; r0 += B) {   // pass A: GN statistics of the whole upsampled tensor + the 1x1 shortcut
      const r1 = Math.min(H, r0 + B), rows = r1 - r0;
      computeU(r0, r1);
      nwg += gnPartial(g, { x: { buf: ub, size: rows * W * Ci * 2 }, pix: rows * W, C: Ci, part: c.part, wgOff: nwg });
      this.conv(c, ub, p + '.conv_shortcut', { Hi: rows, Wi: W, Ho: rows, Wo: W, y: s, yOff: r0 * W * Co * 2 });
      await g.done(); if (check) check();
    }
    gnFinalize(g, { part: c.part, nwg, C: Ci, gb: { buf: c.sh.buf, gOff: c.sh.t(p + '.norm1.weight').off, bOff: c.sh.t(p + '.norm1.bias').off }, ab: { buf: c.ab, off: 0 }, eps: 1e-6 });
    for (let r0 = 0; r0 < H; r0 += B) {   // pass B: recompute each band with a 1-row halo -> conv1 (GN/SiLU prologue) -> h rows
      const r1 = Math.min(H, r0 + B), a = Math.max(0, r0 - 1), b = Math.min(H, r1 + 1);
      computeU(a, b);
      this.conv(c, ub, p + '.conv1', { Hi: b - a, Wi: W, Ho: r1 - r0, Wo: W, padT: a - r0 + 1, padL: 1, gn: 0, y: h, yOff: r0 * W * Co * 2 });
      await g.done(); if (check) check();
    }
    this.drop(ub, y);
    const a2 = this.gn(c, h, H * W, Co, p + '.norm2', 1);
    this.conv(c, h, p + '.conv2', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a2, y: s, res: true });
    this.drop(h);
    return s;
  }

  /** latent f32 [h*w][128] (DiT tokens) -> RGBA8 Uint8ClampedArray [16h][16w][4].  sh = the vae.dec shard handle.  opts {check, onBlock, forceBand, rgbFloat} */
  async decode(sh, latent, h, w, opts = {}) {
    const g = this.g, H8 = 2 * h, W8 = 2 * w, H = 16 * h, W = 16 * w, t = (n) => sh.t(n);
    const c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const banded = opts.forceBand != null ? opts.forceBand : H * W * 256 * 2 > this.bandAboveMB * 1e6;
    const tick = async (i) => { await g.done(); if (opts.check) opts.check(); if (opts.onBlock) opts.onBlock(i); };
    try {
      const z = g.buffer(H8 * W8 * 32 * 2, 'vae.z');
      layout(g, { op: 'vaeIn', n: H8 * W8 * 32, xf: { buf: latent }, v: { buf: sh.buf }, yh: { buf: z }, a: w, c: t('bn.running_mean').off / 4, d: t('bn.running_var').off / 4 });
      const z2 = g.buffer(H8 * W8 * 32 * 2, 'vae.z2');
      this.conv(c, z, 'post_quant_conv', { Hi: H8, Wi: W8, Ho: H8, Wo: W8, y: z2 }); this.drop(z);
      let x = g.buffer(H8 * W8 * 512 * 2, 'vae.x');
      this.conv(c, z2, 'decoder.conv_in', { Hi: H8, Wi: W8, Ho: H8, Wo: W8, y: x }); this.drop(z2);
      x = this.res(c, x, 'decoder.mid_block.resnets.0', 512, 512, H8, W8);
      x = this.attn(c, x, 'decoder.mid_block.attentions.0', H8, W8);
      x = this.res(c, x, 'decoder.mid_block.resnets.1', 512, 512, H8, W8);
      await tick(0);
      let Hc = H8, Wc = W8, C = 512, blk = 1;
      const chans = [512, 512, 256, 128];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === 3 && j === 0 && banded) continue;
          x = this.res(c, x, `decoder.up_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i];
          await tick(blk++);
        }
        if (i < 2 || (i === 2 && !banded)) { x = this.upsample(c, x, `decoder.up_blocks.${i}.upsamplers.0.conv`, Hc, Wc, C); Hc *= 2; Wc *= 2; await tick(blk++); }
        else if (i === 2) { x = await this.bandUp3(c, x, Hc, Wc, opts.check); Hc *= 2; Wc *= 2; C = 128; await tick(blk++); }
      }
      const ao = this.gn(c, x, H * W, 128, 'decoder.conv_norm_out', 0), rgb = g.buffer(H * W * 3 * 4, 'vae.rgb');
      convDirect(g, { x: { buf: x }, w: { buf: sh.buf, off: t('decoder.conv_out.weight').off }, f: { buf: sh.buf }, bOff: t('decoder.conv_out.bias').off / 4,
        g: { buf: c.ab }, abOff: ao, gn: true, out32: true, y: { buf: rgb }, Hi: H, Wi: W, Ci: 128, Ho: H, Wo: W, Co: 3, ks: 3, padT: 1, padL: 1 });
      this.drop(x);
      const px = g.buffer(H * W * 4, 'vae.rgba');
      layout(g, { op: 'rgba8', n: H * W, xf: { buf: rgb }, yu: { buf: px } });
      const out = { rgba: new Uint8ClampedArray(await g.read(px, 0, H * W * 4)), width: W, height: H };
      if (opts.rgbFloat) out.rgb = new Float32Array(await g.read(rgb, 0, H * W * 12));
      this.drop(rgb, px);
      return out;
    } finally { this.drop(c.ab, c.part); }
  }

  /** image f16 HWC [H][W][3] in [-1, 1] (GPUBuffer) -> tokens f32 [(H/16)(W/16)][128] (BN-normalised posterior mean).
   *  sh = vae.enc shard handle; bn = a handle holding bn.running_mean / bn.running_var (vae.dec part) */
  async encode(sh, bn, img, H, W, opts = {}) {
    const g = this.g, c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const tick = async () => { await g.done(); if (opts.check) opts.check(); };
    try {
      let x = g.buffer(H * W * 128 * 2, 'vae.x');
      convDirect(g, { x: { buf: img }, w: { buf: sh.buf, off: sh.t('encoder.conv_in.weight').off }, f: { buf: sh.buf }, bOff: sh.t('encoder.conv_in.bias').off / 4,
        y: { buf: x }, Hi: H, Wi: W, Ci: 3, Ho: H, Wo: W, Co: 128, ks: 3, padT: 1, padL: 1 });
      let Hc = H, Wc = W, C = 128;
      const chans = [128, 256, 512, 512];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) { x = this.res(c, x, `encoder.down_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i]; await tick(); }
        if (i < 3) {
          const y = g.buffer((Hc / 2) * (Wc / 2) * C * 2, 'vae.down');
          this.conv(c, x, `encoder.down_blocks.${i}.downsamplers.0.conv`, { Hi: Hc, Wi: Wc, Ho: Hc / 2, Wo: Wc / 2, stride: 2, y });
          this.drop(x); x = y; Hc /= 2; Wc /= 2;
        }
      }
      x = this.res(c, x, 'encoder.mid_block.resnets.0', 512, 512, Hc, Wc);
      x = this.attn(c, x, 'encoder.mid_block.attentions.0', Hc, Wc);
      x = this.res(c, x, 'encoder.mid_block.resnets.1', 512, 512, Hc, Wc);
      await tick();
      const a = this.gn(c, x, Hc * Wc, 512, 'encoder.conv_norm_out', 0), y = g.buffer(Hc * Wc * 64 * 2, 'vae.y64');
      this.conv(c, x, 'encoder.conv_out', { Hi: Hc, Wi: Wc, Ho: Hc, Wo: Wc, gn: a, y }); this.drop(x);
      const q = g.buffer(Hc * Wc * 32 * 2, 'vae.q32');
      this.conv(c, y, 'quant_conv', { Hi: Hc, Wi: Wc, Ho: Hc, Wo: Wc, N: 32, y: q }); this.drop(y);
      const hw = (Hc / 2) * (Wc / 2), tok = g.buffer(hw * 128 * 4, 'vae.reftok');
      layout(g, { op: 'vaeOut', n: hw * 128, xh: { buf: q }, v: { buf: bn.buf }, yf: { buf: tok }, a: Wc / 2, b: 32, c: bn.t('bn.running_mean').off / 4, d: bn.t('bn.running_var').off / 4 });
      const out = new Float32Array(await g.read(tok, 0, hw * 128 * 4));
      this.drop(q, tok);
      return out;
    } finally { this.drop(c.ab, c.part); }
  }
}
