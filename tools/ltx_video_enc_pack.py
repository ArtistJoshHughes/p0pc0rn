"""ltx_video_enc_pack.py - the LTX-2.3 VIDEO encoder (Lightricks' AutoencoderKLLTX2Video.encoder, causal 3-D) -> the phone's clip-reader
pack (pocketflux.pack/1), for style video-to-video: a source clip becomes SANA-Video 2.0 latent frames on the phone.

  python tools/ltx_video_enc_pack.py <vae diffusion_pytorch_model.safetensors> <out dir> [--enc f16|q8] [--version 2026.11.01-1]

Needs numpy. The source is the LTX-2.3 VAE in the Diffusers layout (its 170 tensors are byte-identical to the vae.* tensors of Lightricks'
LTX-2.3 release); only encoder.* and latents_mean / latents_std are read. What the pack holds:
  - every causal 3x3x3 conv as the engine's conv3 GEMM weight [Cout][27 * Cin], k = ((kt * 3 + ky) * 3 + kx) * Cin + c (time tap kt = 0..2
    reads frames t-2..t), f16 (or q8g64s.t64 with --enc q8); biases f32;
  - conv_in's input channels padded 48 -> 64 (zeros; the patch order c*16 + dx*4 + dy, as Diffusers' patchify);
  - conv_out keeps the 128 mean channels (the clip's latent = the posterior's mode = its mean);
  - act_scale 64: down_blocks.3's downsampler conv and the mid block's conv2s are stored / 64 (and its space-to-depth residual is scaled by
    1/64 at run time: res_scale), so the stream after down3 stays well inside f16 (PixelNorm makes it exact) - the still encoder's scheme;
  - one shard per stage (conv_in + down0, down1, down2, down3, mid + conv_out + latents_mean / std): the engine keeps one stage's weights
    on the GPU at a time;
  - manifest.json with every shard's and every 16 MiB chunk's sha256, the source's sha256, the LTX-2 licence notice.
Nothing is uploaded anywhere."""
import argparse, hashlib, json, os, struct, time
import numpy as np

CHUNK, ALIGN, ACT = 16 * 1024 * 1024, 256, 64.0
STAGES = [  # (name, down-block index, resnets, channels in, downsample stride (t, h, w), channels out)
    ('down0', 0, 4, 128, (1, 2, 2), 256), ('down1', 1, 6, 256, (2, 1, 1), 512), ('down2', 2, 4, 512, (2, 2, 2), 1024), ('down3', 3, 2, 1024, (2, 2, 2), 1024)]
HERE = os.path.dirname(os.path.abspath(__file__))


def read_st(path):
    f = open(path, 'rb'); n = struct.unpack('<Q', f.read(8))[0]; head = json.loads(f.read(n)); base = 8 + n; head.pop('__metadata__', None)
    def get(name):
        h = head[name]; a, b = h['data_offsets']; f.seek(base + a); raw = f.read(b - a)
        if h['dtype'] == 'BF16': x = (np.frombuffer(raw, '<u2').astype(np.uint32) << 16).view(np.float32)
        elif h['dtype'] == 'F32': x = np.frombuffer(raw, '<f4')
        elif h['dtype'] == 'F16': x = np.frombuffer(raw, '<f2').astype(np.float32)
        else: raise SystemExit(f'{name}: dtype {h["dtype"]}')
        return x.reshape(h['shape']).astype(np.float32)
    return head, get


def conv3(w, pad_to=None):
    """[Cout][Cin][3][3][3] -> [Cout][27 * Cin'] tap-major (Cin padded with zero channels to pad_to)"""
    co, ci = w.shape[:2]
    if pad_to and pad_to > ci: w = np.concatenate([w, np.zeros((co, pad_to - ci, 3, 3, 3), np.float32)], 1); ci = pad_to
    return np.ascontiguousarray(w.transpose(0, 2, 3, 4, 1).reshape(co, 27 * ci))


def q8g64s(w):
    """[R][K] -> q8g64s.t64 records: per (64-row tile, 64-k group) 1024 u32 of int8 codes (row-major, 64 B a row) + 32 u32 of f16 scales"""
    R, K = w.shape; assert R % 64 == 0 and K % 64 == 0
    g = w.reshape(R, K // 64, 64); amax = np.abs(g).max(-1); sc = (amax / 127.0).astype(np.float16)
    scf = sc.astype(np.float32); scf[scf == 0] = 1.0
    codes = np.clip(np.rint(g / scf[..., None]), -127, 127).astype(np.int8)   # [R][G][64]
    t = codes.reshape(R // 64, 64, K // 64, 64).transpose(0, 2, 1, 3)          # [tile][G][row][64]
    s = sc.reshape(R // 64, 64, K // 64).transpose(0, 2, 1)                    # [tile][G][row]
    rec = np.concatenate([t.reshape(R // 64, K // 64, 4096).view(np.uint8), s.reshape(R // 64, K // 64, 64).view(np.uint8)], -1)
    return np.ascontiguousarray(rec).tobytes(), (codes.astype(np.float32) * scf[..., None]).reshape(R, K)


def sha(b): return hashlib.sha256(b).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--enc', default='f16', choices=['f16', 'q8']); ap.add_argument('--version', default=None)
    a = ap.parse_args()
    head, get = read_st(a.src)
    src_sha = hashlib.sha256(open(a.src, 'rb').read()).hexdigest()
    os.makedirs(a.out, exist_ok=True)
    tensors, shards, err = {}, [], {}
    enc_name = 'f16' if a.enc == 'f16' else 'q8g64s.t64'

    def shard(name, parts):
        buf = bytearray()
        for tn, enc, shape, b, src in parts:
            assert len(buf) % ALIGN == 0
            tensors[tn] = {'offset': len(buf), 'bytes': len(b), 'shape': shape, 'enc': enc, 'layout': 'rowmajor', 'src': src, 'shard': name}
            buf += b; buf += bytes((-len(buf)) % ALIGN)
        data = bytes(buf); fn = name + '.pfw'
        with open(os.path.join(a.out, fn), 'wb') as f: f.write(data)
        shards.append({'name': name, 'file': fn, 'kind': 'vae_video_encoder', 'bytes': len(data), 'sha256': sha(data), 'chunk_bytes': CHUNK,
                       'chunk_sha256': [sha(data[i:i + CHUNK]) for i in range(0, len(data), CHUNK)]})

    def conv(name, src, scale=1.0, pad_to=None, rows=None):
        w = get(src + '.weight'); b = get(src + '.bias')
        if rows: w = w[:rows]; b = b[:rows]
        W = conv3(w, pad_to) * scale; B = (b * scale).astype(np.float32)
        if a.enc == 'q8' and W.shape[0] % 64 == 0 and W.shape[1] % 64 == 0:
            wb, deq = q8g64s(W); enc = 'q8g64s.t64'
        else:
            wb = W.astype(np.float16).tobytes(); deq = W.astype(np.float16).astype(np.float32); enc = 'f16'
        err[name] = float(np.linalg.norm(deq - W) / (np.linalg.norm(W) + 1e-30))
        s = [{'component': 'vae', 'name': src + '.weight', 'rows': [0, W.shape[0]]}]
        return [(name + '.weight', enc, [W.shape[0], W.shape[1]], wb, s), (name + '.bias', 'f32', [W.shape[0]], B.tobytes(), [{'component': 'vae', 'name': src + '.bias'}])]

    t0 = time.time(); E = 'encoder.'
    stages = []
    for si, (nm, bi, nres, ch, down, out) in enumerate(STAGES):
        parts = conv(E + 'conv_in', E + 'conv_in.conv', pad_to=64) if si == 0 else []
        for r in range(nres):
            for c in ('conv1', 'conv2'):
                p = f'{E}down_blocks.{bi}.resnets.{r}.{c}'; parts += conv(p, p + '.conv')
        p = f'{E}down_blocks.{bi}.downsamplers.0.conv'
        parts += conv(p, p + '.conv', scale=(1 / ACT if bi == 3 else 1.0))
        shard(f'vae.venc.{si}', parts)
        PP = down[0] * down[1] * down[2]
        stages.append({'name': nm, 'shard': f'vae.venc.{si}', 'ch': ch, 'res': nres, 'down': list(down), 'out': out, 'conv_ch': out // PP, 'res_scale': 1 / ACT if bi == 3 else 1.0})
    parts = []
    for r in range(2):
        for c in ('conv1', 'conv2'):
            p = f'{E}mid_block.resnets.{r}.{c}'; parts += conv(p, p + '.conv', scale=(1 / ACT if c == 'conv2' else 1.0))
    parts += conv(E + 'conv_out', E + 'conv_out.conv', rows=128)
    for k in ('latents_mean', 'latents_std'): parts.append((k, 'f32', [128], get(k).astype(np.float32).tobytes(), [{'component': 'vae', 'name': k}]))
    shard('vae.venc.4', parts)
    # every encoder tensor of the source is used (conv_out's logvar row is the only part left out)
    used = {s['name'] for t in tensors.values() for s in t['src']}
    left = [k for k in head if (k.startswith('encoder.') or k.startswith('latents')) and k not in used]
    if left: raise SystemExit(f'encoder tensors not packed: {left[:6]}')

    lic = os.path.join(HERE, '..', 'licenses', 'LICENSE-LTX-2.txt')
    with open(lic, 'rb') as f: open(os.path.join(a.out, 'LICENSE-LTX-2.txt'), 'wb').write(f.read())
    notice = ('# Clip reader (LTX-2.3 video encoder), p0pc0rn pack\n\nLTX-2.3 by Lightricks, under the LTX-2 Community License Agreement (LICENSE-LTX-2.txt), '
              'including the use restrictions in its Attachment A.\n\nThis pack is a Derivative: the encoder half of the LTX-2.3 video autoencoder, '
              f'converted for phones by tools/ltx_video_enc_pack.py ({enc_name} weights, re-laid out for the engine\'s 3-D convolution, conv_in padded, '
              'conv_out cut to its mean channels, down_blocks.3 and the mid block rescaled by 1/64); not the original files.\n')
    open(os.path.join(a.out, 'NOTICE.md'), 'w', encoding='utf-8', newline='\n').write(notice)
    ver = a.version or time.strftime('%Y.%m.%d-') + a.enc
    m = {'format': 'pocketflux.pack', 'format_version': 1, 'pack_id': f'ltx23-video-encoder-{a.enc}', 'pack_version': ver,
         'model': {'id': 'ltx23-video-encoder', 'arch': 'ltx2-video-encoder', 'kind': 'encoder', 'for': ['sana-video2'],
                   'enc': {'patch': 4, 'in_ch': 48, 'in_ch_padded': 64, 'latent_ch': 128, 's_compress': 32, 't_compress': 8, 'causal': True,
                           'pixelnorm_eps': 1e-08, 'act_scale': ACT, 'conv_in': {'shard': 'vae.venc.0', 'ch': 128}, 'stages': stages,
                           'mid': {'shard': 'vae.venc.4', 'ch': 1024, 'res': 2}, 'conv_out': {'shard': 'vae.venc.4', 'ch': 128}, 'scaling_factor': 1.0,
                           'tiles': {'sample': 512, 'stride': 448},
                           'input': 'RGB in [-1, 1], 8k + 1 frames, H and W multiples of 32; patch channel = c*16 + dx*4 + dy; causal in time (frame t reads t-2..t, the first frame replicated)'}},
         'encodings': {'f16': 'FORMAT.md 5.4', 'f32': '5.4', 'q8g64s.t64': '5.2'},
         'quant_recipe': f'LTX-2.3 video encoder, causal 3x3x3 convs {enc_name}; biases + latents_mean/std f32; act_scale 64',
         'sources': [{'component': 'vae', 'file': os.path.basename(a.src), 'sha256': src_sha,
                      'origin': 'Lightricks/LTX-2.3 (the vae.* tensors of ltx-2.3-22b-dev.safetensors, Diffusers layout)', 'license': 'LTX-2 Community License Agreement'}],
         'license': {'files': ['LICENSE-LTX-2.txt', 'NOTICE.md'], 'notice': 'NOTICE.md', 'attribution': ['LTX-2.3 VAE: Lightricks, LTX-2 Community License'],
                     'modified': f'the encoder only, {enc_name}, re-laid out and rescaled by the p0pc0rn packer; not the original files.'},
         'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'packer': 'tools/ltx_video_enc_pack.py 1', 'shards': shards, 'tensors': tensors}
    mb = json.dumps(m, indent=1).encode(); open(os.path.join(a.out, 'manifest.json'), 'wb').write(mb)
    print(json.dumps({'out': a.out, 'enc': a.enc, 'shards': [(s['name'], s['bytes']) for s in shards], 'bytes': sum(s['bytes'] for s in shards),
                      'manifest_sha256': sha(mb), 'worst_weight_rel_err': max(err.values()), 'seconds': round(time.time() - t0, 1)}, indent=1))


if __name__ == '__main__':
    main()
