"""stt_pack.py - NVIDIA Nemotron 3.5 ASR Streaming 0.6B (nvidia/nemotron-3.5-asr-streaming-0.6b, OpenMDW-1.1) -> the phone's
speech-to-text pack (pocketflux.pack/1) for engine/stt/.

  python tools/stt_pack.py <model dir with model.safetensors + tokenizer.json> <out dir> [--version 2026.11.01-1] [--revision <hf sha>]

Needs numpy. The model is a cache-aware FastConformer-RNNT (24 conformer layers, d 1024, 8 heads, conv kernel 9, 8x causal
subsampling to 80 ms frames, 128 mels) with a language-ID prompt and an RNN-T decoder (2-layer LSTM 640, joint 640 -> 13,088).
What the pack holds (engine/stt/ reads exactly this; the math is the same, only folded and re-laid out):
  - every matrix of the encoder, the prompt projector, the decoder and the joint as q8g64r: int8 codes [N][K] row-major, then one
    fp16 scale per 64 inputs [N][K/64] (symmetric: max|w| / 127, round half away from zero); the small convolutions, the LayerNorms,
    bias_u / bias_v and every bias in fp32;
  - the relative-position term as a table: R[d] = relative_k_proj(pos(d)) for d = query - key = +69 .. -69 (fp16 [139][1024] per layer;
    pos(d) is the model's own sin/cos encoding), so relative_k_proj itself is not shipped;
  - the language prompt folded: prompt_projector.linear_1 acting on [x ; one-hot(lang)] = W[:, :1024] x + (b + W[:, 1024 + lang]);
    the [128][2048] table of per-language biases is stored;
  - prompt_projector.linear_2 and encoder_projector folded into one 2048 -> 640 linear (W_ep W_2, W_ep b_2 + b_ep);
  - the LSTM's weight_ih and weight_hh side by side ([2560][1280] acting on [x ; h]) and b_ih + b_hh;
  - q|k|v of each layer as one [3072][1024] matrix; the depthwise conv tap-major [9][1024];
  - the 128-band Slaney mel filter bank for n_fft 512 at 16 kHz (librosa's formula) [128][257] fp32;
  - the vocabulary as JSON (13,087 pieces, the blank is 13,087), with the special tokens (language tags, <unk>) marked.
One shard per conformer layer (stt.layer.NN), stt.front (mel + subsampling), stt.head (prompt, decoder, joint), stt.vocab.
manifest.json: shards with sha256 per file and per 16 MiB chunk (the phone verifies every chunk), the tensors, the source files'
sha256, the licence (OpenMDW-1.1) and NVIDIA's notices; LICENSE, NOTICE.md, README.md beside it.
Nothing is uploaded anywhere: the pack is written to <out dir>."""
import argparse, hashlib, json, math, os, struct, time
import numpy as np

D, H, HD, NL, LEFT, RMAX = 1024, 8, 128, 24, 56, 70
VOCAB, BLANK = 13088, 13087
CHUNK, ALIGN = 16 * 1024 * 1024, 256
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_REPO = 'nvidia/nemotron-3.5-asr-streaming-0.6b'


def sha(b): return hashlib.sha256(b).hexdigest()


def read_safetensors(path):
    with open(path, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        head = json.loads(f.read(n)); base = 8 + n
    head.pop('__metadata__', None)
    mm = np.memmap(path, dtype=np.uint8, mode='r')
    out = {}
    for k, h in head.items():
        if h['dtype'] != 'F32': raise SystemExit(f'{k}: expected F32, got {h["dtype"]}')
        a, b = h['data_offsets']
        out[k] = np.frombuffer(mm[base + a: base + b], dtype='<f4').reshape(h['shape'])
    return out


def mel_filters(sr=16000, n_fft=512, n_mels=128, fmin=0.0, fmax=8000.0):
    """librosa.filters.mel(sr, n_fft, n_mels, fmin, fmax, htk=False, norm='slaney') in float64 (then fp32)"""
    def hz2mel(f):
        f = np.asanyarray(f, dtype=np.float64); mel = f / (200.0 / 3)
        lin = 1000.0 / (200.0 / 3); logstep = np.log(6.4) / 27.0
        return np.where(f >= 1000.0, lin + np.log(np.maximum(f, 1e-10) / 1000.0) / logstep, mel)
    def mel2hz(m):
        m = np.asanyarray(m, dtype=np.float64); f = (200.0 / 3) * m
        lin = 1000.0 / (200.0 / 3); logstep = np.log(6.4) / 27.0
        return np.where(m >= lin, 1000.0 * np.exp(logstep * (m - lin)), f)
    fft = np.linspace(0, sr / 2, 1 + n_fft // 2)
    mpts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    fd = np.diff(mpts); ramps = mpts[:, None] - fft[None, :]
    w = np.zeros((n_mels, 1 + n_fft // 2))
    for i in range(n_mels):
        lo = -ramps[i] / fd[i]; hi = ramps[i + 2] / fd[i + 1]
        w[i] = np.maximum(0, np.minimum(lo, hi))
    w *= (2.0 / (mpts[2:n_mels + 2] - mpts[:n_mels]))[:, None]
    return w.astype(np.float32)


def q8g64r(w):
    """[N][K] fp32 -> (int8 codes [N][K] | fp16 scales [N][K/64]) bytes, and the dequantised fp32 (for the self-check)"""
    w = np.ascontiguousarray(w, dtype=np.float32); n, k = w.shape
    if k % 64: raise SystemExit(f'q8g64r needs K % 64 == 0, got {w.shape}')
    g = w.reshape(n, k // 64, 64).astype(np.float64)
    s = (np.abs(g).max(-1) / 127.0).astype(np.float16)
    s = np.where(s == 0, np.float16(1.0), s)
    sd = s.astype(np.float64)[..., None]
    q = np.clip(np.sign(g) * np.floor(np.abs(g) / sd + 0.5), -127, 127).astype(np.int8)
    return q.tobytes() + s.astype('<f2').tobytes(), (q.astype(np.float64) * sd).reshape(n, k)


def pos_table():
    """the model's relative positional encoding for d = +69 .. -69 (Transformer-XL sin/cos, interleaved) [139][1024] float64"""
    d = np.arange(RMAX - 1, -RMAX, -1, dtype=np.float64)
    inv = 1.0 / (10000.0 ** (np.arange(0, D, 2, dtype=np.float64) / D))
    f = d[:, None] * inv[None]
    return np.stack([np.sin(f), np.cos(f)], -1).reshape(len(d), D)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--version', default=None); ap.add_argument('--revision', default='ea30d66debe3740a08b573244286791d423d6b3e')
    a = ap.parse_args()
    t0 = time.time()
    st_path = os.path.join(a.src, 'model.safetensors'); tok_path = os.path.join(a.src, 'tokenizer.json'); cfg_path = os.path.join(a.src, 'config.json')
    cfg = json.load(open(cfg_path, encoding='utf-8')); ec = cfg['encoder_config']
    want = dict(hidden_size=D, num_attention_heads=H, num_hidden_layers=NL, intermediate_size=4096, conv_kernel_size=9, num_mel_bins=128,
                subsampling_factor=8, subsampling_conv_channels=256, sliding_window=LEFT + 1)
    for k, v in want.items():
        if ec.get(k) != v: raise SystemExit(f'encoder_config.{k} = {ec.get(k)}, the engine runs {v}')
    if cfg['vocab_size'] != VOCAB or cfg['blank_token_id'] != BLANK or cfg['decoder_hidden_size'] != 640 or cfg['num_decoder_layers'] != 2 \
            or cfg['num_prompts'] != 128 or cfg['max_symbols_per_step'] != 10 or cfg['hidden_act'] != 'relu' or ec['hidden_act'] != 'silu':
        raise SystemExit('config.json is not the Nemotron 3.5 ASR Streaming layout the engine runs')
    T = read_safetensors(st_path)
    os.makedirs(a.out, exist_ok=True)
    tensors, shards, worst = {}, [], {}

    def f32(x): return np.ascontiguousarray(x, dtype='<f4').tobytes()

    def shard(name, parts, kind):
        buf = bytearray()
        for tn, enc, shape, b, src in parts:
            assert len(buf) % ALIGN == 0
            rec = {'offset': len(buf), 'bytes': len(b), 'shape': list(shape), 'enc': enc, 'layout': 'rowmajor', 'shard': name, 'src': src}
            if enc == 'q8g64r': rec['scales'] = len(buf) + shape[0] * shape[1]
            tensors[f'{name}/{tn}'] = rec
            buf += b; buf += bytes((-len(buf)) % ALIGN)
        data = bytes(buf); fn = name + '.pfw'
        with open(os.path.join(a.out, fn), 'wb') as f: f.write(data)
        shards.append({'name': name, 'file': fn, 'kind': kind, 'bytes': len(data), 'sha256': sha(data), 'chunk_bytes': CHUNK,
                       'chunk_sha256': [sha(data[i:i + CHUNK]) for i in range(0, len(data), CHUNK)]})

    def q8(tn, w, src):
        b, deq = q8g64r(w)
        e = float(np.abs(deq - w.astype(np.float64)).max() / (np.abs(w).max() + 1e-30)); worst[tn] = max(worst.get(tn, 0), e)
        return (tn, 'q8g64r', w.shape, b, src)

    # ---- front: mel bank + causal subsampling
    s = 'encoder.subsampling.'
    front = [('mel_fb', 'f32', (128, 257), f32(mel_filters()), 'librosa slaney mel 128 (n_fft 512, 16 kHz, 0-8 kHz)'),
             ('conv_in.w', 'f32', (256, 9), f32(T[s + 'conv_in.weight'].reshape(256, 9)), s + 'conv_in.weight'),
             ('conv_in.b', 'f32', (256,), f32(T[s + 'conv_in.bias']), s + 'conv_in.bias')]
    for j in range(2):
        p = f'{s}layers.{j}.'
        front += [(f'dw{j}.w', 'f32', (9, 256), f32(T[p + 'depthwise_conv.weight'].reshape(256, 9).T), p + 'depthwise_conv.weight (tap-major)'),
                  (f'dw{j}.b', 'f32', (256,), f32(T[p + 'depthwise_conv.bias']), p + 'depthwise_conv.bias'),
                  (f'pw{j}.w', 'f32', (256, 256), f32(T[p + 'pointwise_conv.weight'].reshape(256, 256)), p + 'pointwise_conv.weight'),
                  (f'pw{j}.b', 'f32', (256,), f32(T[p + 'pointwise_conv.bias']), p + 'pointwise_conv.bias')]
    front += [q8('lin.w', T[s + 'linear.weight'], s + 'linear.weight'), ('lin.b', 'f32', (D,), f32(T[s + 'linear.bias']), s + 'linear.bias')]
    shard('stt.front', front, 'stt_front')

    # ---- 24 conformer layers
    pe = pos_table()
    LN = ['norm_feed_forward1', 'norm_self_att', 'norm_conv', 'norm_feed_forward2', 'norm_out', 'conv.norm']
    for i in range(NL):
        p = f'encoder.layers.{i}.'
        ln = np.stack([T[p + n + x] for n in LN for x in ('.weight', '.bias')])            # [12][1024]
        buv = np.stack([T[p + 'self_attn.bias_u'].reshape(D), T[p + 'self_attn.bias_v'].reshape(D)])
        qkv = np.concatenate([T[p + 'self_attn.q_proj.weight'], T[p + 'self_attn.k_proj.weight'], T[p + 'self_attn.v_proj.weight']], 0)
        R = (pe @ T[p + 'self_attn.relative_k_proj.weight'].astype(np.float64).T)
        if np.abs(R).max() > 65000: raise SystemExit(f'layer {i}: R does not fit fp16')
        parts = [('ln', 'f32', (12, D), f32(ln), p + '{' + ','.join(LN) + '}.{weight,bias}'),
                 ('buv', 'f32', (2, D), f32(buv), p + 'self_attn.bias_{u,v}'),
                 q8('qkv', qkv, p + 'self_attn.{q,k,v}_proj.weight'),
                 q8('o', T[p + 'self_attn.o_proj.weight'], p + 'self_attn.o_proj.weight'),
                 q8('ff1a', T[p + 'feed_forward1.linear1.weight'], p + 'feed_forward1.linear1.weight'),
                 q8('ff1b', T[p + 'feed_forward1.linear2.weight'], p + 'feed_forward1.linear2.weight'),
                 q8('pw1', T[p + 'conv.pointwise_conv1.weight'].reshape(2 * D, D), p + 'conv.pointwise_conv1.weight'),
                 ('dw', 'f32', (9, D), f32(T[p + 'conv.depthwise_conv.weight'].reshape(D, 9).T), p + 'conv.depthwise_conv.weight (tap-major)'),
                 q8('pw2', T[p + 'conv.pointwise_conv2.weight'].reshape(D, D), p + 'conv.pointwise_conv2.weight'),
                 q8('ff2a', T[p + 'feed_forward2.linear1.weight'], p + 'feed_forward2.linear1.weight'),
                 q8('ff2b', T[p + 'feed_forward2.linear2.weight'], p + 'feed_forward2.linear2.weight'),
                 ('R', 'f16', (2 * RMAX - 1, D), R.astype('<f2').tobytes(), p + 'self_attn.relative_k_proj.weight x pos(d), d = +69..-69')]
        shard(f'stt.layer.{i:02d}', parts, 'stt_layer')

    # ---- prompt + decoder + joint
    W1 = T['prompt_projector.linear_1.weight']
    Wep, bep = T['encoder_projector.weight'].astype(np.float64), T['encoder_projector.bias'].astype(np.float64)
    W2, b2 = T['prompt_projector.linear_2.weight'].astype(np.float64), T['prompt_projector.linear_2.bias'].astype(np.float64)
    head = [q8('p1.w', W1[:, :D], 'prompt_projector.linear_1.weight[:, :1024]'),
            ('p1.lang', 'f32', (128, 2048), f32(T['prompt_projector.linear_1.bias'][None, :] + W1[:, D:].T),
             'prompt_projector.linear_1.bias + weight[:, 1024 + lang]'),
            q8('ep.w', (Wep @ W2).astype(np.float32), 'encoder_projector.weight @ prompt_projector.linear_2.weight'),
            ('ep.b', 'f32', (640,), f32(Wep @ b2 + bep), 'encoder_projector.weight @ linear_2.bias + encoder_projector.bias'),
            q8('emb', T['decoder.embedding.weight'], 'decoder.embedding.weight')]
    for l in range(2):
        Wc = np.concatenate([T[f'decoder.lstm.weight_ih_l{l}'], T[f'decoder.lstm.weight_hh_l{l}']], 1)
        head += [q8(f'lstm{l}.w', Wc, f'decoder.lstm.weight_ih_l{l} | weight_hh_l{l}'),
                 (f'lstm{l}.b', 'f32', (2560,), f32(T[f'decoder.lstm.bias_ih_l{l}'].astype(np.float64) + T[f'decoder.lstm.bias_hh_l{l}']),
                  f'decoder.lstm.bias_ih_l{l} + bias_hh_l{l}')]
    head += [q8('dp.w', T['decoder.decoder_projector.weight'], 'decoder.decoder_projector.weight'),
             ('dp.b', 'f32', (640,), f32(T['decoder.decoder_projector.bias']), 'decoder.decoder_projector.bias'),
             q8('jh.w', T['joint.head.weight'], 'joint.head.weight'),
             ('jh.b', 'f32', (VOCAB,), f32(T['joint.head.bias']), 'joint.head.bias')]
    shard('stt.head', head, 'stt_head')

    # ---- vocabulary
    tj = json.load(open(tok_path, encoding='utf-8'))
    vocab = tj['model']['vocab']; pieces = [None] * BLANK
    for piece, i in vocab.items():
        if i < BLANK: pieces[i] = piece
    special = {int(t['id']): t['content'] for t in tj['added_tokens'] if t['special'] and int(t['id']) < BLANK}
    for i, c in special.items(): pieces[i] = c
    if any(p is None for p in pieces): raise SystemExit('the vocabulary has holes')
    pp = json.load(open(os.path.join(a.src, 'processor_config.json'), encoding='utf-8'))
    voc = {'pieces': pieces, 'special': sorted(special), 'blank': BLANK, 'space': chr(0x2581), 'prompts': pp['prompt_dictionary']}
    vb = json.dumps(voc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with open(os.path.join(a.out, 'stt.vocab.json'), 'wb') as f: f.write(vb)
    shards.append({'name': 'stt.vocab', 'file': 'stt.vocab.json', 'kind': 'tokenizer', 'bytes': len(vb), 'sha256': sha(vb), 'chunk_bytes': CHUNK,
                   'chunk_sha256': [sha(vb[i:i + CHUNK]) for i in range(0, len(vb), CHUNK)]})

    # ---- licence and notices
    with open(os.path.join(HERE, '..', 'licenses', 'LICENSE-OpenMDW-1.1.txt'), 'rb') as f: lic = f.read()
    with open(os.path.join(a.out, 'LICENSE'), 'wb') as f: f.write(lic)
    st_sha = sha_file(st_path); tok_sha = sha_file(tok_path)
    notice = ('# Speech to text: NVIDIA Nemotron 3.5 ASR Streaming 0.6B\n\n'
              f'Model by NVIDIA Corporation: https://huggingface.co/{SRC_REPO} (revision {a.revision}).\n\n'
              'NVIDIA\'s model card, "License/Terms of Use": "Governing Terms: Use of the model is governed by the OpenMDW-1.1 license." '
              'The card says: "This model is ready for commercial use." The full agreement is LICENSE beside this file.\n\n'
              'Modified by the p0pc0rn project: converted and quantized from the original weights (8-bit, one scale per 64 weights), with '
              'the language prompt, the projections and the relative-position term folded as README.md lists. Not the original files. This '
              'is not an official NVIDIA product, and NVIDIA has not endorsed it. "NVIDIA" and "Nemotron" are NVIDIA trademarks; no trademark '
              'rights are granted.\n\n'
              f'Source files: model.safetensors sha256 {st_sha}; tokenizer.json sha256 {tok_sha}.\n')
    with open(os.path.join(a.out, 'NOTICE.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(notice)
    readme = ('# Speech to text (p0pc0rn pack)\n\nNVIDIA Nemotron 3.5 ASR Streaming 0.6B for p0pc0rn\'s on-device speech to text '
              '(engine/stt/). ' + __doc__.split('What the pack holds')[1].split('One shard per')[0].strip().replace('\n  ', '\n') + '\n\nSee NOTICE.md and LICENSE (OpenMDW-1.1).\n')
    with open(os.path.join(a.out, 'README.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(readme)

    ver = a.version or time.strftime('%Y.%m.%d-1')
    m = {
        'format': 'pocketflux.pack', 'format_version': 1, 'pack_id': f'nemotron35-asr-0.6b-{ver}', 'pack_version': ver,
        'model': {'id': 'nemotron35-asr-0.6b', 'name': 'Speech to text', 'arch': 'nemotron-asr-streaming-rnnt', 'kind': 'stt',
                  'enc': {'layers': NL, 'd': D, 'heads': H, 'ff': 4096, 'conv_kernel': 9, 'left_context': LEFT, 'rmax': RMAX,
                          'lookahead': [0, 1, 3, 6, 13], 'frame_ms': 80, 'subsampling': 8, 'mels': 128, 'n_fft': 512, 'hop': 160, 'win': 400,
                          'preemphasis': 0.97, 'log_guard': 2 ** -24, 'sample_rate': 16000},
                  'dec': {'hidden': 640, 'lstm_layers': 2, 'vocab': VOCAB, 'blank': BLANK, 'max_symbols': 10, 'prompts': 128,
                          'auto_prompt': cfg.get('default_prompt_id', 101)}},
        'encodings': {'q8g64r': 'int8 codes [N][K] row-major, then fp16 scales [N][K/64] at "scales"; w = code * scale',
                      'f32': 'little-endian fp32', 'f16': 'little-endian fp16'},
        'quant_recipe': 'q8g64r for every matrix (symmetric, max|w| / 127 per 64 inputs); fp32 convs, norms, biases; fp16 position table',
        'quant_worst_rel_err': round(max(worst.values()), 5),
        'sources': [{'component': 'model', 'repo': SRC_REPO, 'revision': a.revision, 'file': 'model.safetensors', 'sha256': st_sha},
                    {'component': 'tokenizer', 'repo': SRC_REPO, 'revision': a.revision, 'file': 'tokenizer.json', 'sha256': tok_sha}],
        'license': {'id': 'OpenMDW-1.1', 'files': ['LICENSE', 'NOTICE.md', 'README.md'], 'notice': 'NOTICE.md',
                    'credit': 'NVIDIA Nemotron 3.5 ASR Streaming 0.6B by NVIDIA Corporation, OpenMDW-1.1',
                    'attribution': ['NVIDIA Nemotron 3.5 ASR Streaming 0.6B: NVIDIA Corporation, OpenMDW-1.1'],
                    'modified': 'Modified by the p0pc0rn project: converted and quantized from the original weights.'},
        'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'packer': 'tools/stt_pack.py 1',
        'shards': shards, 'tensors': tensors,
    }
    mb = json.dumps(m, indent=1, ensure_ascii=False).encode('utf-8')
    with open(os.path.join(a.out, 'manifest.json'), 'wb') as f: f.write(mb)
    print(json.dumps({'out': a.out, 'pack_version': ver, 'shards': len(shards), 'bytes': sum(x['bytes'] for x in shards),
                      'layer_shard_bytes': shards[1]['bytes'], 'q8_worst_rel_err': round(max(worst.values()), 5), 'manifest_sha256': sha(mb),
                      'source_sha256': st_sha, 'seconds': round(time.time() - t0, 1)}, indent=1))


def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 24), b''): h.update(b)
    return h.hexdigest()


if __name__ == '__main__':
    main()
