"""sana_lora_pack.py - a SANA-Video 2.0 LoRA from the lab (svcore.save_lora safetensors) -> the phone's LoRA pack (pocketflux.pack/1).

  python3 tools/sana_lora_pack.py <lora.safetensors> <out dir> [--id sanavideo2-5b-lora] [--version 2026.11.01-c16a] [--name "Video LoRA"]

The lab file holds fp32 pairs {blocks.<b>.<target>.lora_A.weight [r, in], .lora_B.weight [out, r]} for the five targets of every one of
the 32 blocks (attn.qkv, attn.output_gate, attn.proj, cross_attn.q_linear, cross_attn.proj) and t_block.1, with metadata rank / alpha.
The lab applies y = W x + (alpha / rank) * B (A x) at multiplier 1.0. The pack:
  - fp16 A and B; alpha / rank is folded into B here, so the phone adds B'(A x) (a job's scale multiplies B' on the GPU);
  - rank padded up to a multiple of 32 with zero rows of A / zero columns of B (the engine's GEMM reduces in steps of 32; exact);
  - one shard per DiT block (lora.block.NN, ~2 MB at rank 32) that the engine uploads beside the block's own weight shard, and
    lora.global (t_block.1, used once per job); tensors 256-byte aligned; in each block shard the A of attn.qkv is followed directly by
    the A of attn.output_gate (the engine reads them as ONE [2r, 2560] matrix: both read the same modulated input), then the other As,
    then every B (one range the engine scales);
  - names: the engine's own tensor names with .lora_A / .lora_B for .weight (blocks.0.attn.qkv.weight -> blocks.0.attn.qkv.lora_A);
  - manifest.json: shards with sha256 per file and per 16 MiB chunk (the phone verifies every chunk), the tensors, the source file's
    sha256, the licence (Apache-2.0) and the credit; LICENSE, NOTICE.md, README.md beside it.
Standard library only. Nothing is uploaded anywhere: the pack is written to <out dir>."""
import argparse, array, hashlib, json, os, struct, sys, time

D, BLOCKS, MODN = 2560, 32, 6 * 2560
TARGETS = ('attn.qkv', 'attn.output_gate', 'attn.proj', 'cross_attn.q_linear', 'cross_attn.proj')
OUT = {'attn.qkv': 3 * D, 'attn.output_gate': D, 'attn.proj': D, 'cross_attn.q_linear': D, 'cross_attn.proj': D, 't_block.1': MODN}
CHUNK, ALIGN = 16 * 1024 * 1024, 256
CREDIT = 'LoRA by Josh Hughes, trained on SANA-Video 2.0 (NVIDIA, Apache-2.0)'
HERE = os.path.dirname(os.path.abspath(__file__))


def read_safetensors(path):
    """-> (metadata dict, {name: (dtype, shape, bytes)}) without numpy / torch"""
    with open(path, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        head = json.loads(f.read(n))
        base = 8 + n
        md = head.pop('__metadata__', {}) or {}
        out = {}
        for name, h in head.items():
            a, b = h['data_offsets']
            f.seek(base + a)
            out[name] = (h['dtype'], h['shape'], f.read(b - a))
    return md, out


def f32_of(dtype, raw):
    if dtype != 'F32':
        raise SystemExit(f'expected F32 tensors (the lab saves fp32 masters), got {dtype}')
    a = array.array('f'); a.frombytes(raw)
    if sys.byteorder != 'little': a.byteswap()
    return a


def half_bytes(vals):
    """float list / array -> little-endian fp16 bytes (IEEE round to nearest even); refuses values fp16 cannot hold"""
    try:
        return struct.pack(f'<{len(vals)}e', *vals)
    except OverflowError:
        raise SystemExit('a LoRA value does not fit fp16 (|x| > 65504): the pack would be wrong')


def lora_A(a32, r, rp, k):
    """[r, k] fp32 -> [rp, k] fp16 (zero rows below r)"""
    return half_bytes(a32) + bytes(2 * (rp - r) * k)


def lora_B(b32, n, r, rp, s):
    """[n, r] fp32 * s -> [n, rp] fp16 (zero columns right of r)"""
    out = bytearray()
    zero = bytes(2 * (rp - r))
    for i in range(n):
        row = b32[i * r:(i + 1) * r]
        out += half_bytes([v * s for v in row] if s != 1.0 else row) + zero
    return bytes(out)


def sha(b): return hashlib.sha256(b).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--id', default='sanavideo2-5b-lora', help='the model id the app and the engine use for it')
    ap.add_argument('--version', default=None, help='pack_version (default: today + the source file name)')
    ap.add_argument('--name', default='Video LoRA')
    a = ap.parse_args()

    raw = open(a.src, 'rb').read()
    md, T = read_safetensors(a.src)
    rank, alpha = int(md.get('rank', 0)), float(md.get('alpha', 0))
    if rank <= 0 or alpha <= 0:
        raise SystemExit('the safetensors metadata has no rank / alpha (svcore.save_lora writes both)')
    if md.get('format') not in (None, 'p0pc0rn-sana-lora/1'):
        raise SystemExit(f"unknown LoRA format {md.get('format')}")
    rp = (rank + 31) // 32 * 32
    s = alpha / rank

    want = [f'blocks.{b}.{t}' for b in range(BLOCKS) for t in TARGETS] + ['t_block.1']
    names = set(T)
    expect = {f'{w}.lora_{x}.weight' for w in want for x in 'AB'}
    if names != expect:
        extra, missing = sorted(names - expect), sorted(expect - names)
        raise SystemExit(f'the LoRA does not have exactly the 5 targets x 32 blocks + t_block.1 the engine runs:'
                         f' {len(missing)} missing {missing[:4]}, {len(extra)} extra {extra[:4]}')
    for w in want:
        da, sa, ra = T[f'{w}.lora_A.weight']; db, sb, rb = T[f'{w}.lora_B.weight']
        n = OUT[w.split('.', 2)[2]] if w.startswith('blocks.') else OUT[w]
        if sa != [rank, D] or sb != [n, rank]:
            raise SystemExit(f'{w}: shapes A {sa} B {sb}, expected A [{rank}, {D}] B [{n}, {rank}]')

    os.makedirs(a.out, exist_ok=True)
    tensors, shards = {}, []

    def shard(name, parts, kind):
        """parts: [(tensor name, for, src, shape, bytes)] -> writes <name>.pfw, registers its tensors"""
        buf = bytearray()
        for tn, for_, src, shape, b in parts:
            assert len(buf) % ALIGN == 0
            tensors[tn] = {'offset': len(buf), 'bytes': len(b), 'shape': shape, 'enc': 'f16', 'layout': 'rowmajor', 'for': for_,
                           'src': [{'component': 'lora', 'name': src, 'rows': [0, shape[0]]}], 'shard': name}
            buf += b
            buf += bytes((-len(buf)) % ALIGN)
        data = bytes(buf)
        fn = name + '.pfw'
        with open(os.path.join(a.out, fn), 'wb') as f:
            f.write(data)
        shards.append({'name': name, 'file': fn, 'kind': kind, 'bytes': len(data), 'sha256': sha(data), 'chunk_bytes': CHUNK,
                       'chunk_sha256': [sha(data[i:i + CHUNK]) for i in range(0, len(data), CHUNK)]})

    def pair(w, n):
        A = f32_of(*T[f'{w}.lora_A.weight'][::2]); B = f32_of(*T[f'{w}.lora_B.weight'][::2])
        return lora_A(A, rank, rp, D), lora_B(B, n, rank, rp, s)

    t0 = time.time()
    for b in range(BLOCKS):
        As, Bs = [], []
        for t in TARGETS:
            w = f'blocks.{b}.{t}'; ab, bb = pair(w, OUT[t])
            As.append((f'{w}.lora_A', f'{w}.weight', f'{w}.lora_A.weight', [rp, D], ab))
            Bs.append((f'{w}.lora_B', f'{w}.weight', f'{w}.lora_B.weight', [OUT[t], rp], bb))
        shard(f'lora.block.{b:02d}', As + Bs, 'lora_block')
    ab, bb = pair('t_block.1', MODN)
    shard('lora.global', [('t_block.1.lora_A', 't_block.1.weight', 't_block.1.lora_A.weight', [rp, D], ab),
                          ('t_block.1.lora_B', 't_block.1.weight', 't_block.1.lora_B.weight', [MODN, rp], bb)], 'lora_global')
    for b in range(BLOCKS):   # the layout the engine relies on (checked again on the phone)
        q, g = tensors[f'blocks.{b}.attn.qkv.lora_A'], tensors[f'blocks.{b}.attn.output_gate.lora_A']
        assert g['offset'] == q['offset'] + q['bytes'], 'qkv / output_gate A must be adjacent'

    lic = os.path.join(HERE, '..', 'licenses', 'LICENSE-Apache-2.0.txt')
    with open(lic, 'rb') as f: lic_text = f.read()
    with open(os.path.join(a.out, 'LICENSE'), 'wb') as f: f.write(lic_text)
    src_name = os.path.basename(a.src)
    notice = (f'# {a.name}\n\n{CREDIT}.\n\n'
              f'- A LoRA (low-rank adapter, rank {rank}, alpha {alpha:g}) for NVIDIA SANA-Video 2.0 5B 720p 4-step '
              f'(Efficient-Large-Model/SANA-Video_2.0_5B_720p_4step, Apache-2.0). It is not the model: it runs with it.\n'
              f'- Licence: Apache License 2.0 (LICENSE).\n'
              f'- The phone runs it with the separately licensed LTX-2.3 video decoder and picture reader (Lightricks, LTX-2 Community '
              f'License Agreement), which p0pc0rn shows before those download.\n'
              f'- This pack: the lab\'s fp32 file ({src_name}, sha256 {sha(raw)}) converted to fp16 by tools/sana_lora_pack.py '
              f'(alpha / rank folded into B, rank padded to {rp}); not the original file.\n')
    with open(os.path.join(a.out, 'NOTICE.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(notice)
    readme = (f'# {a.name} (p0pc0rn pack)\n\n{CREDIT}.\n\nRuns on the phone at run time (y = W x + B\'(A x) on attn.qkv, attn.output_gate, '
              f'attn.proj, cross_attn.q_linear and cross_attn.proj of every block and on t_block.1); the video model\'s weights are not changed. '
              f'One shard per DiT block, streamed with the block. See NOTICE.md and LICENSE.\n')
    with open(os.path.join(a.out, 'README.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(readme)

    ver = a.version or time.strftime('%Y.%m.%d-') + os.path.splitext(src_name)[0].replace('lora_', '')
    meta = {k: str(v) for k, v in md.items()}
    m = {
        'format': 'pocketflux.pack', 'format_version': 1, 'pack_id': f'{a.id}-{ver}', 'pack_version': ver,
        'model': {'id': a.id, 'name': a.name, 'arch': 'sana-video2-lora', 'kind': 'lora',
                  'for': {'arch': 'sana-video2', 'depth': BLOCKS, 'hidden': D}, 'base': md.get('base', ''),
                  'rank': rank, 'rank_padded': rp, 'alpha': alpha, 'scale_folded': s,
                  'rule': "y = W x + B'(A x), B' = (alpha / rank) B folded into the pack; a job's scale multiplies B'",
                  'targets': list(TARGETS), 't_block': True, 'default_scale': 1.0,
                  'layout': 'per block: A of qkv, output_gate (adjacent), proj, cross q_linear, cross proj, then their Bs; lora.global = t_block.1'},
        'encodings': {'f16': 'FORMAT.md 5.4'},
        'quant_recipe': 'fp16 A and B (alpha / rank folded into B), rank padded to a multiple of 32',
        'sources': [{'component': 'lora', 'file': src_name, 'bytes': len(raw), 'sha256': sha(raw), 'metadata': meta}],
        'license': {'id': 'Apache-2.0', 'files': ['LICENSE', 'NOTICE.md', 'README.md'], 'notice': 'NOTICE.md', 'credit': CREDIT,
                    'attribution': [CREDIT, 'SANA-Video 2.0: NVIDIA, Apache-2.0'],
                    'modified': 'fp32 -> fp16, alpha / rank folded, re-laid out by tools/sana_lora_pack.py (pocketflux.pack/1); not the original file.'},
        'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'packer': 'tools/sana_lora_pack.py 1',
        'shards': shards, 'tensors': tensors,
    }
    mb = json.dumps(m, indent=1).encode()
    with open(os.path.join(a.out, 'manifest.json'), 'wb') as f: f.write(mb)
    tot = sum(x['bytes'] for x in shards)
    print(json.dumps({'out': a.out, 'id': a.id, 'pack_version': ver, 'rank': rank, 'alpha': alpha, 'scale_folded': s, 'rank_padded': rp,
                      'shards': len(shards), 'bytes': tot, 'block_shard_bytes': shards[0]['bytes'], 'manifest_sha256': sha(mb),
                      'source_sha256': sha(raw), 'seconds': round(time.time() - t0, 1)}, indent=1))


if __name__ == '__main__':
    main()
