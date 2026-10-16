// MuseTalk 1.5 UNet (diffusers UNet2DConditionModel, SD-1.x layout, in 8 / out 4, cross-attention to 50 audio tokens of 384) on a
// CHUNK of B frames at once (frames stacked: HWC f16 [B][H][W][C]), ONE pass at t = 0.  Weights stream per resnet / transformer /
// resampler shard (new buffer, released right after), so the UNet is never resident (q8 pack 0.88 GB).  The time embedding at t = 0 is
// a constant folded into every resnet's conv1 bias by the packer (pack_lipsync.py), so no time MLP runs here.
'use strict';
import { lgemm } from './lgemm.js';
import { lattn } from './lattn.js';
import { gnStats, gnPartBytesB, rowStats, concat } from './lsops.js';

export const UNET_CH = [320, 640, 1280, 1280];
export const unetFlopsPerFrame = 169.6e9;

export class MuseUNet {
  constructor(gpu, store, opts = {}) { this.g = gpu; this.s = store; this.opts = opts; this.tmp = []; }
  buf(bytes, label) { return this.g.buffer(bytes, label); }
  drop(...bs) { this.g.runner.flush(); for (const b of bs) if (b) this.g.free(b); }
  w(sh, name) { return sh.t(name); }
  /** f32 vector tensor as {buf, off(floats)} (biases / norm params live in the shard as f32) */
  v(sh, name) { const t = sh.t(name); return { buf: t.buf, off: t.off / 4 }; }

  // ---------------------------------------------------------------- building blocks
  conv(sh, name, x, o) {   // o: {B, Hi, Wi, Ci, Co, ks, stride, pad, up2, gn: {buf, off, C, act}, y, res, epi, Kreal}
    const W = this.w(sh, name + '.weight'), b = this.v(sh, name + '.bias');
    const ks = o.ks || 3, st = o.stride || 1, up = !!o.up2;
    const Hin = up ? 2 * o.Hi : o.Hi, Win = up ? 2 * o.Wi : o.Wi, pad = o.pad != null ? o.pad : (ks >> 1);
    const Ho = Math.floor((Hin + 2 * pad - ks) / st) + 1, Wo = Math.floor((Win + 2 * pad - ks) / st) + 1;
    const K = W.cols, Co = o.Co || W.rows;
    lgemm(this.g, { w: W, x: { buf: x }, M: o.B * Ho * Wo, N: Co, K, epi: o.epi || 'f16', res: !!o.res, bv: b, y: { buf: o.y, ld: Co },
      conv: { Hi: o.Hi, Wi: o.Wi, Ci: o.Ci, Ho, Wo, stride: st, padT: pad, padL: pad, kh: ks, kw: ks, Kreal: o.Kreal || ks * ks * o.Ci, up2: up, gn: o.gn } });
    return { Ho, Wo };
  }
  gn(sh, name, x, B, HW, C, eps) {
    gnStats(this.g, { x: { buf: x }, B, HW, C, eps, gb: { buf: sh.t(name + '.weight').buf, gOff: sh.t(name + '.weight').off / 4, bOff: sh.t(name + '.bias').off / 4 },
      ab: { buf: this.ab, off: 0 }, part: this.part });
    return { buf: this.ab, off: 0, C };
  }
  resnet(sh, p, x, B, H, W, Ci, Co) {
    const g = this.g, M = B * H * W;
    const a1 = this.gn(sh, p + '.norm1', x, B, H * W, Ci, 1e-5);
    const h = this.buf(M * Co * 2, 'unet.h');
    this.conv(sh, p + '.conv1', x, { B, Hi: H, Wi: W, Ci, gn: Object.assign({ act: 'silu' }, a1), y: h });
    const out = this.buf(M * Co * 2, 'unet.res');
    if (Ci !== Co) this.conv(sh, p + '.conv_shortcut', x, { B, Hi: H, Wi: W, Ci, ks: 1, pad: 0, y: out });
    else g.runner.copy(x, 0, out, 0, M * Co * 2);
    const a2 = this.gn(sh, p + '.norm2', h, B, H * W, Co, 1e-5);
    this.conv(sh, p + '.conv2', h, { B, Hi: H, Wi: W, Ci: Co, gn: Object.assign({ act: 'silu' }, a2), y: out, res: true });
    this.drop(h);
    return out;
  }
  /** Transformer2DModel (1 BasicTransformerBlock), in place on x (HWC f16 [B][HW][C]) */
  transformer(sh, p, x, B, H, W, C, audio) {
    const g = this.g, HW = H * W, M = B * HW, heads = 8, Dh = C / heads, tb = p + '.transformer_blocks.0';
    const a0 = this.gn(sh, p + '.norm', x, B, HW, C, 1e-6);
    const t = this.buf(M * C * 4, 'unet.t'), st = this.buf(M * 8, 'unet.st');
    this.conv(sh, p + '.proj_in', x, { B, Hi: H, Wi: W, Ci: C, ks: 1, pad: 0, gn: Object.assign({ act: 'none' }, a0), y: t, epi: 'f32' });
    const ln = (name) => { rowStats(g, { x: { buf: t }, M, C, eps: 1e-5, out: { buf: st } }); return { buf: sh.t(name + '.weight').buf, g: sh.t(name + '.weight').off / 4, b: sh.t(name + '.bias').off / 4 }; };
    // self-attention
    let L = ln(tb + '.norm1');
    const qkv = this.buf(M * 3 * C * 2, 'unet.qkv');
    lgemm(g, { w: this.w(sh, tb + '.attn1.to_qkv.weight'), x: { buf: t, mode: 'ln', ld: C }, stats: { buf: st }, ln: L, M, N: 3 * C, K: C, epi: 'f16', y: { buf: qkv, ld: 3 * C } });
    const o = this.buf(M * C * 2, 'unet.o');
    lattn(g, { Dr: Dh, B, H: heads, Lq: HW, Lk: HW, scale: 1 / Math.sqrt(Dh),
      q: { buf: qkv, off: 0, ld: 3 * C, hS: Dh, bS: HW * 3 * C }, k: { buf: qkv, off: C, ld: 3 * C, hS: Dh, bS: HW * 3 * C },
      v: { buf: qkv, off: 2 * C, ld: 3 * C, hS: Dh, bS: HW * 3 * C }, o: { buf: o, off: 0, ld: C, hS: Dh, bS: HW * C } });
    this.drop(qkv);
    lgemm(g, { w: this.w(sh, tb + '.attn1.to_out.0.weight'), x: { buf: o }, M, N: C, K: C, epi: 'add', bv: this.v(sh, tb + '.attn1.to_out.0.bias'), y: { buf: t, ld: C } });
    // cross-attention to the audio tokens
    L = ln(tb + '.norm2');
    lgemm(g, { w: this.w(sh, tb + '.attn2.to_q.weight'), x: { buf: t, mode: 'ln', ld: C }, stats: { buf: st }, ln: L, M, N: C, K: C, epi: 'f16', y: { buf: o, ld: C } });
    const kv = this.buf(B * 50 * 2 * C * 2, 'unet.kv');
    lgemm(g, { w: this.w(sh, tb + '.attn2.to_kv.weight'), x: { buf: audio }, M: B * 50, N: 2 * C, K: 384, epi: 'f16', y: { buf: kv, ld: 2 * C } });
    const o2 = this.buf(M * C * 2, 'unet.o2');
    lattn(g, { Dr: Dh, B, H: heads, Lq: HW, Lk: 50, scale: 1 / Math.sqrt(Dh),
      q: { buf: o, off: 0, ld: C, hS: Dh, bS: HW * C }, k: { buf: kv, off: 0, ld: 2 * C, hS: Dh, bS: 50 * 2 * C },
      v: { buf: kv, off: C, ld: 2 * C, hS: Dh, bS: 50 * 2 * C }, o: { buf: o2, off: 0, ld: C, hS: Dh, bS: HW * C } });
    this.drop(kv, o);
    lgemm(g, { w: this.w(sh, tb + '.attn2.to_out.0.weight'), x: { buf: o2 }, M, N: C, K: C, epi: 'add', bv: this.v(sh, tb + '.attn2.to_out.0.bias'), y: { buf: t, ld: C } });
    this.drop(o2);
    // GEGLU feed-forward
    L = ln(tb + '.norm3');
    const ff = this.buf(M * 4 * C * 2, 'unet.ff'), fb = this.v(sh, tb + '.ff.net.0.proj.bias');
    lgemm(g, { w: this.w(sh, tb + '.ff.net.0.proj.weight'), x: { buf: t, mode: 'ln', ld: C }, stats: { buf: st }, ln: L, M, N: 8 * C, K: C, epi: 'geglu',
      wr0: 4 * C, wr1: 0, bv: { buf: fb.buf, off: fb.off + 4 * C, up: fb.off }, y: { buf: ff, ld: 4 * C } });
    lgemm(g, { w: this.w(sh, tb + '.ff.net.2.weight'), x: { buf: ff }, M, N: C, K: 4 * C, epi: 'add', bv: this.v(sh, tb + '.ff.net.2.bias'), y: { buf: t, ld: C } });
    this.drop(ff, st);
    // proj_out + residual (in place on x)
    lgemm(g, { w: this.w(sh, p + '.proj_out.weight'), x: { buf: t, mode: 'f32', ld: C }, M, N: C, K: C, epi: 'f16', res: true, bv: this.v(sh, p + '.proj_out.bias'), y: { buf: x, ld: C } });
    this.drop(t);
    return x;
  }

  /** latents f16 HWC [B][32][32][8] (GPUBuffer), audio f16 [B][50][384] (GPUBuffer, PE added) -> f32 [B][32][32][4] (new GPUBuffer)
   *  opts {check, onStage(i, n), keep (map name -> tensor dump hook for tests)} */
  async run(lat, audio, B, opts = {}) {
    const g = this.g, s = this.s, CH = UNET_CH;
    const HW0 = 32 * 32;
    this.ab = this.buf(B * 2 * 2560 * 4, 'unet.gnab'); this.part = this.buf(Math.max(gnPartBytesB(B, HW0), 256), 'unet.gnpart');
    const stages = this.stages(); let si = 0;
    const tick = async (name) => { await g.done(); if (opts.check) opts.check(); if (opts.onStage) opts.onStage(++si, stages.length, name); };
    // probes v002: with opts.slab every block's weights go into the same buffer (the upload waits for nothing: the queue orders the writes
    // after the previous block's submitted dispatches, and tick() has already waited for them)
    const use = async (name, fn) => { const sh = await s.upload(name, this.opts.slab || null); try { return await fn(sh); } finally { g.runner.flush(); s.release(sh); } };
    const dump = async (name, buf, n, f32) => { if (opts.keep && opts.keep[name]) opts.keep[name](f32 ? new Float32Array(await g.read(buf, 0, n * 4)) : new Uint16Array(await g.read(buf, 0, n * 2))); };
    try {
      let H = 32, W = 32, C = 320;
      let h = this.buf(B * HW0 * 320 * 2, 'unet.x');
      await use('unet.in', async (sh) => this.conv(sh, 'conv_in', lat, { B, Hi: 32, Wi: 32, Ci: 8, Kreal: 72, y: h }));
      await dump('conv_in', h, B * HW0 * 320); await tick('conv_in');
      const skips = [{ b: h, H, W, C }];
      for (let i = 0; i < 4; i++) {
        const Co = CH[i];
        for (let j = 0; j < 2; j++) {
          const nh = await use(`unet.down.${i}.res.${j}`, async (sh) => this.resnet(sh, `down_blocks.${i}.resnets.${j}`, h, B, H, W, C, Co));
          C = Co; h = nh; await tick(`down${i}.res${j}`);
          if (i < 3) { await use(`unet.down.${i}.attn.${j}`, async (sh) => this.transformer(sh, `down_blocks.${i}.attentions.${j}`, h, B, H, W, C, audio)); await tick(`down${i}.attn${j}`); }
          skips.push({ b: h, H, W, C });
        }
        if (i < 3) {
          const y = this.buf(B * (H / 2) * (W / 2) * C * 2, 'unet.ds');
          await use(`unet.down.${i}.ds`, async (sh) => this.conv(sh, `down_blocks.${i}.downsamplers.0.conv`, h, { B, Hi: H, Wi: W, Ci: C, stride: 2, pad: 1, y }));
          h = y; H /= 2; W /= 2; skips.push({ b: h, H, W, C }); await tick(`down${i}.ds`);
        }
        await dump(`down${i}`, h, B * H * W * C);
      }
      // mid
      let m = await use('unet.mid.res.0', async (sh) => this.resnet(sh, 'mid_block.resnets.0', h, B, H, W, C, C)); await tick('mid.res0');
      await use('unet.mid.attn.0', async (sh) => this.transformer(sh, 'mid_block.attentions.0', m, B, H, W, C, audio)); await tick('mid.attn0');
      const m2 = await use('unet.mid.res.1', async (sh) => this.resnet(sh, 'mid_block.resnets.1', m, B, H, W, C, C)); this.drop(m); m = m2; await tick('mid.res1');
      await dump('mid', m, B * H * W * C);
      // up
      h = m;
      const RCH = [1280, 1280, 640, 320];
      for (let i = 0; i < 4; i++) {
        const Co = RCH[i];
        for (let j = 0; j < 3; j++) {
          const sk = skips.pop(), Cc = C + sk.C, M = B * H * W;
          const hc = this.buf(M * Cc * 2, 'unet.cat');
          concat(g, { x1: h, x2: sk.b, y: hc, M, C1: C, C2: sk.C });
          this.drop(h); if (sk.b !== h) this.drop(sk.b);
          h = await use(`unet.up.${i}.res.${j}`, async (sh) => this.resnet(sh, `up_blocks.${i}.resnets.${j}`, hc, B, H, W, Cc, Co));
          this.drop(hc); C = Co; await tick(`up${i}.res${j}`);
          if (i > 0) { await use(`unet.up.${i}.attn.${j}`, async (sh) => this.transformer(sh, `up_blocks.${i}.attentions.${j}`, h, B, H, W, C, audio)); await tick(`up${i}.attn${j}`); }
        }
        if (i < 3) {
          const y = this.buf(B * H * W * 4 * C * 2, 'unet.us');
          await use(`unet.up.${i}.us`, async (sh) => this.conv(sh, `up_blocks.${i}.upsamplers.0.conv`, h, { B, Hi: H, Wi: W, Ci: C, up2: true, y }));
          this.drop(h); h = y; H *= 2; W *= 2; await tick(`up${i}.us`);
        }
        await dump(`up${i}`, h, B * H * W * C);
      }
      // out
      const out = this.buf(B * HW0 * 4 * 4, 'unet.out');
      await use('unet.out', async (sh) => {
        const a = this.gn(sh, 'conv_norm_out', h, B, HW0, 320, 1e-5);
        this.conv(sh, 'conv_out', h, { B, Hi: 32, Wi: 32, Ci: 320, Co: 4, gn: Object.assign({ act: 'silu' }, a), y: out, epi: 'f32' });
      });
      this.drop(h); await tick('out');
      return out;
    } finally { this.drop(this.ab, this.part); this.ab = this.part = null; }
  }
  stages() {
    const n = ['conv_in'];
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 2; j++) { n.push(`down${i}.res${j}`); if (i < 3) n.push(`down${i}.attn${j}`); } if (i < 3) n.push(`down${i}.ds`); }
    n.push('mid.res0', 'mid.attn0', 'mid.res1');
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 3; j++) { n.push(`up${i}.res${j}`); if (i > 0) n.push(`up${i}.attn${j}`); } if (i < 3) n.push(`up${i}.us`); }
    n.push('out');
    return n;
  }
}
