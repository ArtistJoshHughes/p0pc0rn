// sd-vae-ft-mse (AutoencoderKL: 128/256/512/512, 2 resnets per level, GroupNorm 32 eps 1e-6, mid self-attention d 512, 4 latent
// channels, scaling 0.18215) at 256x256, built from the engine's FLUX.2 VAE blocks (models/flux2_vae.js: res / attn / upsample / conv /
// gn on single-image HWC f16 tensors, ops/gemm.js implicit-GEMM convs with fused GroupNorm+SiLU) - the block structure and the diffusers
// tensor names are identical.  Only the latent ends differ (no BN / patchify, 4 / 8 channels): quant_conv and post_quant_conv (1x1,
// 8x8 / 4x4) run on the CPU, conv_in (Cin 3 / 4) and conv_out (Cout 3) use ops/misc.js convDirect.  No shared file is modified.
'use strict';
import { Flux2VAE } from '../models/flux2_vae.js';
import { gnPartBytes, convDirect } from '../ops/misc.js';
import { rgba8 } from './lsops.js';
import { f2h } from '../core/gpu.js';

export const SCALE = 0.18215;
export const vaeEncFlops = 270.6e9, vaeDecFlops = 620.0e9;

export class SDVae extends Flux2VAE {
  constructor(gpu, opts = {}) { super(gpu, Object.assign({ bandAboveMB: 1e9 }, opts)); this.acc = opts.acc || 'f32'; }

  /** img: Float32Array or Uint16Array(f16) HWC [256][256][3] in [-1, 1]; sh = 'vae.enc' handle -> Float32Array [32*32*8] (h8 = conv_out
   *  output before quant_conv, HWC) — the caller applies quant_conv + mean + scaling (encodeLatent) */
  async encodeRaw(sh, img16, H = 256, W = 256, opts = {}) {
    const g = this.g, c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const tick = async () => { await g.done(); if (opts.check) opts.check(); };
    try {
      const xin = g.upload(img16, 'vae.in');
      let x = g.buffer(H * W * 128 * 2, 'vae.x');
      convDirect(g, { x: { buf: xin }, w: { buf: sh.buf, off: sh.t('encoder.conv_in.weight').off }, f: { buf: sh.buf }, bOff: sh.t('encoder.conv_in.bias').off / 4,
        y: { buf: x }, Hi: H, Wi: W, Ci: 3, Ho: H, Wo: W, Co: 128, ks: 3, padT: 1, padL: 1 });
      this.drop(xin);
      let Hc = H, Wc = W, C = 128;
      const chans = [128, 256, 512, 512];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) { x = this.res(c, x, `encoder.down_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i]; if (opts.fine) await tick(); }
        if (i < 3) {
          const y = g.buffer((Hc / 2) * (Wc / 2) * C * 2, 'vae.down');
          this.conv(c, x, `encoder.down_blocks.${i}.downsamplers.0.conv`, { Hi: Hc, Wi: Wc, Ho: Hc / 2, Wo: Wc / 2, stride: 2, y });
          this.drop(x); x = y; Hc /= 2; Wc /= 2;
        }
        await tick();
      }
      x = this.res(c, x, 'encoder.mid_block.resnets.0', 512, 512, Hc, Wc);
      x = this.attn(c, x, 'encoder.mid_block.attentions.0', Hc, Wc);
      x = this.res(c, x, 'encoder.mid_block.resnets.1', 512, 512, Hc, Wc);
      const a = this.gn(c, x, Hc * Wc, 512, 'encoder.conv_norm_out', 0), y = g.buffer(Hc * Wc * 8 * 2, 'vae.y8');
      this.conv(c, x, 'encoder.conv_out', { Hi: Hc, Wi: Wc, Ho: Hc, Wo: Wc, gn: a, y }); this.drop(x);
      const r = new Uint16Array(await g.read(y, 0, Hc * Wc * 8 * 2)); this.drop(y);
      return r;
    } finally { this.drop(c.ab, c.part); }
  }

  /** latent f32 NCHW-free: z [32*32][4] HWC (already x 0.18215, i.e. the UNet's output) -> RGBA8 Uint8Array [256*256*4] (MuseTalk rounding) */
  async decode(sh, z, h = 32, w = 32, opts = {}) {
    const g = this.g, H = 8 * h, W = 8 * w, t = (n) => sh.t(n);
    const c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const tick = async () => { await g.done(); if (opts.check) opts.check(); };
    try {
      const pq = this.pqc || (this.pqc = { w: opts.pqW, b: opts.pqB });
      const z16 = new Uint16Array(h * w * 4);
      for (let p = 0; p < h * w; p++) for (let o = 0; o < 4; o++) {   // z / 0.18215 -> post_quant_conv (1x1, 4 -> 4) on the CPU
        let s = pq.b[o]; for (let i = 0; i < 4; i++) s += pq.w[o * 4 + i] * (z[p * 4 + i] / SCALE);
        z16[p * 4 + o] = f2h(s);
      }
      const zb = g.upload(z16, 'vae.z');
      let x = g.buffer(h * w * 512 * 2, 'vae.x');
      convDirect(g, { x: { buf: zb }, w: { buf: sh.buf, off: t('decoder.conv_in.weight').off }, f: { buf: sh.buf }, bOff: t('decoder.conv_in.bias').off / 4,
        y: { buf: x }, Hi: h, Wi: w, Ci: 4, Ho: h, Wo: w, Co: 512, ks: 3, padT: 1, padL: 1 });
      this.drop(zb);
      x = this.res(c, x, 'decoder.mid_block.resnets.0', 512, 512, h, w);
      x = this.attn(c, x, 'decoder.mid_block.attentions.0', h, w);
      x = this.res(c, x, 'decoder.mid_block.resnets.1', 512, 512, h, w);
      await tick();
      let Hc = h, Wc = w, C = 512;
      const chans = [512, 512, 256, 128];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) { x = this.res(c, x, `decoder.up_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i]; }
        if (i < 3) { x = this.upsample(c, x, `decoder.up_blocks.${i}.upsamplers.0.conv`, Hc, Wc, C); Hc *= 2; Wc *= 2; }
        await tick();
      }
      const ao = this.gn(c, x, H * W, 128, 'decoder.conv_norm_out', 0), rgb = g.buffer(H * W * 4 * 4, 'vae.rgb');
      convDirect(g, { x: { buf: x }, w: { buf: sh.buf, off: t('decoder.conv_out.weight').off }, f: { buf: sh.buf }, bOff: t('decoder.conv_out.bias').off / 4,
        g: { buf: c.ab }, abOff: ao, gn: true, out32: true, y: { buf: rgb }, Hi: H, Wi: W, Ci: 128, Ho: H, Wo: W, Co: 4, ks: 3, padT: 1, padL: 1 });
      this.drop(x);
      const px = g.buffer(H * W * 4, 'vae.rgba');
      rgba8(g, rgb, px, H * W);
      const out = new Uint8Array(await g.read(px, 0, H * W * 4));
      if (opts.keepRgb) opts.keepRgb(new Float32Array(await g.read(rgb, 0, H * W * 16)));
      this.drop(rgb, px);
      return out;
    } finally { this.drop(c.ab, c.part); }
  }
}

/** h8 (Uint16 f16 HWC [1024][8]) -> latent Float32Array HWC [1024][4] = 0.18215 * mean(quant_conv(h8)) */
export function encodeLatent(h8, qw, qb, h2f) {
  const n = h8.length / 8, out = new Float32Array(n * 4);
  for (let p = 0; p < n; p++) for (let o = 0; o < 4; o++) {
    let s = qb[o]; for (let i = 0; i < 8; i++) s += qw[o * 8 + i] * h2f(h8[p * 8 + i]);
    out[p * 4 + o] = SCALE * s;
  }
  return out;
}

/** MuseTalk VAE.preprocess_img: RGB uint8 [256*256*3] -> f16 HWC in [-1, 1]; half: rows >= 128 set to 0 BEFORE the normalisation (-> -1) */
export function vaeInput(rgb, half) {
  const o = new Uint16Array(256 * 256 * 3), lut = new Uint16Array(256), m1 = f2h(-1);
  for (let v = 0; v < 256; v++) lut[v] = f2h((v / 255 - 0.5) / 0.5);
  for (let i = 0; i < 256 * 256 * 3; i++) o[i] = (half && i >= 128 * 256 * 3) ? m1 : lut[rgb[i]];
  return o;
}
