"""nowcast_pack.py - the Nowcast's model packs (DeepMind's DGMR, the 256x256 TF-Hub snapshot, CC BY 4.0) for nowcast/dgmr/.

Two packs, each a pocketflux.pack (manifest.json: every file's sha256 and the sha256 of every 16 MiB chunk, which the phone checks):
  <out>/         the 8-bit integer model (the low-memory one): dgmr_int8.json + dgmr_int8.bin (GPU) + dgmr_int8_host.bin (CPU tables)
  <out>/f16/     the floating-point model (the default):        dgmr_f16.json  + dgmr_f16.bin  (GPU) + dgmr_f16_host.bin  (CPU tables)
config.js pins both: 'dgmr-nowcast': [<out address>, <int8 manifest sha256>, { 'f16/': <f16 manifest sha256> }].

Inputs (made from the TF-Hub snapshot by the reference tools):
  --tf-weights  tf_weights.npz   every constant the forward pass reads (spectrally normalised conv weights, biases, BN constants),
                                 keyed '<TF op name>#<input index>'
  --int8-model / --int8-weights  the integer model (op list with integer parameters + int8 weights) the reference probe ran
  --license     the CC BY 4.0 legal code (https://creativecommons.org/licenses/by/4.0/legalcode.txt)
The float model's op list is the reference graph (build() below, read off the TF graph): the same tensors and ops, in the same order,
as the integer model. Weights: each conv's [k, k, Cin, Cout] times its gain (attention gamma) as [K][Cout] (K = tap * Cin + ci),
16-bit floats two to a u32 along K (or 32-bit with --wenc f32); biases and every BN table 32-bit.
usage: python nowcast_pack.py --tf-weights tf_weights.npz --int8-model model.json --int8-weights weights.bin --license legalcode.txt --out <dir>
"""
import argparse, hashlib, json, os, struct, time
import numpy as np

CHUNK = 16 * 1024 * 1024
G = "Generator_3/"
CREDIT = 'Nowcast model: DeepMind DGMR (CC BY 4.0), modified'
SOURCE = 'https://github.com/google-deepmind/deepmind-research/tree/master/nowcasting'


def sha(b): return hashlib.sha256(b).hexdigest()


def shard(name, fn, data, kind):
    return {'name': name, 'file': fn, 'kind': kind, 'bytes': len(data), 'sha256': sha(data), 'chunk_bytes': CHUNK,
            'chunk_sha256': [sha(data[i:i + CHUNK]) for i in range(0, len(data), CHUNK)]}


# ------------------------------------------------------------------------------------------------ the graph (the reference)
class Graph:
    def __init__(self, W): self.W = W; self.T = []; self.ops = []

    def tensor(self, n, h, w, c, kind, name):
        self.T.append(dict(n=n, h=h, w=w, c=c, kind=kind, name=name)); return len(self.T) - 1

    def ref(self, t, i0=0, n=None, relu=0): return dict(t=t, i0=i0, n=self.T[t]["n"] if n is None else n, relu=relu)

    def _out(self, out, n, h, w, c, kind, name):
        if out is None: return self.ref(self.tensor(n, h, w, c, kind, name))
        T = self.T[out["t"]]; assert (T["h"], T["w"], T["c"]) == (h, w, c), (T, h, w, c)
        return dict(t=out["t"], i0=out["i0"], n=n, relu=0)

    def conv(self, ins, scope, k, act, cout, up=0, kind=None, out=None, bias=True, gain=1.0):
        n = ins[0]["n"]; h = self.T[ins[0]["t"]]["h"]; w = self.T[ins[0]["t"]]["w"]
        cin = [self.T[r["t"]]["c"] for r in ins]
        wkey = f"{G}{scope}/convolution#1"; bkey = f"{G}{scope}/BiasAdd#1" if bias else None
        assert self.W[wkey].shape == (k, k, sum(cin), cout), (wkey, self.W[wkey].shape)
        if kind is None: kind = {"none": "i8", "relu": "u8", "sigmoid": "g8"}[act]
        H, Wd = (h * 2, w * 2) if up else (h, w)
        o = self._out(out, n, H, Wd, cout, kind, scope)
        self.ops.append(dict(op="conv", ins=ins, out=o, k=k, up=up, act=act, w=wkey, b=bkey, gain=gain, name=scope)); return o

    def add(self, a, b, name, pool=0, up_b=0):
        Ta = self.T[a["t"]]; n = a["n"]
        H, Wd = (Ta["h"] // 2, Ta["w"] // 2) if pool else (Ta["h"], Ta["w"])
        o = self._out(None, n, H, Wd, Ta["c"], "i8", name)
        self.ops.append(dict(op="add", a=a, b=b, out=o, pool=pool, up_b=up_b, name=name)); return o

    def cbn(self, x, scope, cond=True):
        T = self.T[x["t"]]; o = self._out(None, x["n"], T["h"], T["w"], T["c"], "u8", scope)
        if cond: bn = dict(cond=1, ws=f"{G}{scope}/scale_wrapper_1/scale/MatMul#1", wo=f"{G}{scope}/offset_wrapper_1/offset/MatMul#1",
                           c0=f"{G}{scope}/add#1", rs=f"{G}{scope}/batchnorm/mul#0", mean=f"{G}{scope}/batchnorm/mul_2#0")
        else: bn = dict(cond=0, mul=f"{G}{scope}/batchnorm/mul_1#1", sub=f"{G}{scope}/batchnorm/add_1#1")
        self.ops.append(dict(op="cbn", x=x, out=o, bn=bn, name=scope)); return o

    def gmul(self, r, h, name):
        T = self.T[h["t"]]; o = self._out(None, 1, T["h"], T["w"], T["c"], "u8", name)
        self.ops.append(dict(op="gmul", r=r, h=h, out=o, name=name)); return o

    def gru(self, u, h, c, out, name):
        T = self.T[c["t"]]; o = self._out(out, 1, T["h"], T["w"], T["c"], "u8", name)
        self.ops.append(dict(op="gru", u=u, h=h, c=c, out=o, name=name)); return o


def build(W):
    g = Graph(W)
    x0 = g.ref(g.tensor(4, 128, 128, 4, "i16", "input_s2d")); g.ops.append(dict(op="input", out=x0, name="input"))
    d, d_list, chans = x0, [], [48, 96, 192, 384]
    for i, c in enumerate(chans):
        s = f"CondEncoder/DBlock{'' if i == 0 else '_' + str(i)}"; pre = 0 if i == 0 else 1
        h1 = g.conv([dict(d, relu=pre)], f"{s}/conv0_wrapper_1/conv0", 3, "relu", c)
        h2 = g.conv([h1], f"{s}/conv1_wrapper_1/conv1", 3, "none", c)
        sc = g.conv([d], f"{s}/conv_sc_wrapper_1/conv_sc", 1, "none", c)
        d = g.add(h2, [sc], f"{s}/add", pool=1); d_list.append(d)
    init = []
    for i, d in enumerate(d_list):
        init.append(g.conv([g.ref(d["t"], j, 1) for j in range(4)], f"CondEncoder/hh_temp_{i}_wrapper_1/hh_temp_{i}", 3, "relu", chans[i]))
    z = g.ref(g.tensor(1, 8, 8, 8, "i8", "z")); g.ops.append(dict(op="zin", out=z, name="z"))
    l = g.conv([z], "mini_conv_net/sn_wrapper_1/conv_2d", 3, "none", 8)
    for blk, c, att in (("mini_conv_block_1", 24, 0), ("mini_conv_block_1_2", 48, 0), ("mini_conv_block_2_1", 192, 1), ("mini_conv_block_3_1", 768, 0)):
        s = f"mini_conv_net/{blk}"; cin = g.T[l["t"]]["c"]
        h1 = g.conv([dict(l, relu=1)], f"{s}/sn_wrapper/conv_2d", 3, "relu", c)
        h2 = g.conv([h1], f"{s}/sn_wrapper_1/conv_2d", 3, "none", c)
        sc = g.conv([l], f"{s}/sn_wrapper_2/conv_2d", 1, "none", c - cin)
        l = g.add(h2, [l, sc], f"{s}/add")
        if att:
            a = "mini_conv_net/mini_attention_1"
            q = g.conv([l], f"{a}/sn_wrapper/conv_2d", 1, "none", 48, bias=False)
            k = g.conv([l], f"{a}/sn_wrapper_1/conv_2d", 1, "none", 48, bias=False)
            v = g.conv([l], f"{a}/sn_wrapper_2/conv_2d", 1, "none", 48, bias=False)
            o = g.ref(g.tensor(1, 8, 8, 48, "i8", f"{a}/attn")); g.ops.append(dict(op="attn", q=q, k=k, v=v, out=o, name=f"{a}/attn"))
            p = g.conv([o], f"{a}/sn_wrapper_3/conv_2d", 1, "none", 192, bias=False, gain=float(W[f"{G}{a}/mul#0"]))
            l = g.add(p, [l], f"{a}/add")
    latent = l
    gb_names = [("GBlock", "GBlock_2"), ("GBlock_3", "GBlock_5"), ("GBlock_6", "GBlock_8"), ("GBlock_9", "GBlock_11")]
    xseq = None
    for j in range(4):
        hstate = init[3 - j]; Ts = g.T[hstate["t"]]; ch = Ts["c"]
        S = g.tensor(18, Ts["h"], Ts["w"], ch, "u8", f"gru{j}_state")
        sc0 = f"{'rnn' if j == 0 else f'rnn_{j}'}/g_gru_{j}"
        for t in range(18):
            hp = hstate if t == 0 else g.ref(S, t - 1, 1)
            xt = latent if j == 0 else g.ref(xseq["t"], t, 1)
            r = g.conv([xt, hp], f"{sc0}/conv_r_wrapper_1/conv_r", 3, "sigmoid", ch)
            u = g.conv([xt, hp], f"{sc0}/conv_u_wrapper_1/conv_u", 3, "sigmoid", ch)
            rh = g.gmul(r, hp, f"{sc0}_{t}/rh")
            c = g.conv([xt, rh], f"{sc0}/conv_c_wrapper_1/conv_c", 3, "relu", ch)
            g.gru(u, hp, c, g.ref(S, t, 1), f"{sc0}_{t}/state")
        hh = g.conv([g.ref(S)], f"hh_g_{j}_wrapper_1/hh_g_{j}", 3, "none", 2 * ch)
        b0, b1 = gb_names[j]
        a = g.cbn(hh, f"{b0}/BatchNorm"); a = g.conv([a], f"{b0}/conv0_wrapper_1/conv0", 3, "none", 2 * ch)
        a = g.cbn(a, f"{b0}/BatchNorm_1"); a = g.conv([a], f"{b0}/conv1_wrapper_1/conv1", 3, "none", 2 * ch)
        gb = g.add(a, [hh], f"{b0}/add")
        a = g.cbn(gb, f"{b1}/BatchNorm"); a = g.conv([a], f"{b1}/conv0_wrapper_1/conv0", 3, "none", 2 * ch, up=1)
        a = g.cbn(a, f"{b1}/BatchNorm_1"); a = g.conv([a], f"{b1}/conv1_wrapper_1/conv1", 3, "none", ch)
        sc = g.conv([gb], f"{b1}/conv_sc_wrapper_1/conv_sc", 1, "none", ch)
        xseq = g.add(a, [sc], f"{b1}/add", up_b=1)
    f = g.cbn(xseq, "BatchNorm", cond=False)
    g.output = g.conv([f], "conv_to_rgb_wrapper_1/conv_to_rgb", 1, "none", 4, kind="i16")
    return g


# ------------------------------------------------------------------------------------------------ the float model
def float_model(W, wenc, zslice, thr, z_scale):
    g = build(W)
    gpu, host = bytearray(), bytearray()
    def put_gpu(arr):                     # -> word offset
        off = len(gpu) // 4; b = arr.tobytes(); gpu.extend(b); gpu.extend(b'\0' * ((-len(b)) % 16)); return off
    def put_host(arr):                    # f32 -> float offset
        off = len(host) // 4; host.extend(np.ascontiguousarray(arr, '<f4').tobytes()); return off
    ops, seen = [], {}                   # the GRU's convs are the same weights at every lead time: stored once
    for op in g.ops:
        o = {k: v for k, v in op.items() if k not in (('w', 'b', 'gain') if op['op'] == 'conv' else ('bn',))}
        if op['op'] == 'conv' and (op['w'], op['b'], op['gain']) in seen: o['woff'], o['boff'] = seen[(op['w'], op['b'], op['gain'])]
        elif op['op'] == 'conv':
            Wt = (W[op['w']].astype(np.float32) * np.float32(op['gain']))
            k, _, cin, cout = Wt.shape; K = k * k * cin
            M = Wt.reshape(K, cout)
            if wenc == 'f16':
                h = M.astype('<f2').reshape(K // 2, 2, cout).transpose(0, 2, 1).copy()   # [K/2][Cout][2]: (even k, odd k) in one u32
                o['woff'] = put_gpu(h)
            else: o['woff'] = put_gpu(np.ascontiguousarray(M, '<f4'))
            b = W[op['b']].astype('<f4') if op['b'] else np.zeros(cout, '<f4')
            o['boff'] = put_gpu(b); seen[(op['w'], op['b'], op['gain'])] = (o['woff'], o['boff'])
        elif op['op'] == 'cbn':
            bn = op['bn']; o['cond'] = bn['cond']
            if bn['cond']:
                o['ws'] = put_host(W[bn['ws']]); o['wo'] = put_host(W[bn['wo']])        # [256][C]
                o['c0'] = float(np.asarray(W[bn['c0']]).reshape(-1)[0])
                o['rs'] = put_host(W[bn['rs']][0, :, 0, 0, :]); o['mean'] = put_host(W[bn['mean']][0, :, 0, 0, :])   # [18][C]
            else:
                o['mul'] = put_host(W[bn['mul']][0, :, 0, 0, :]); o['sub'] = put_host(W[bn['sub']][0, :, 0, 0, :])
        ops.append(o)
    m = {'format': 'p0pc0rn.dgmr', 'precision': 'float', 'wenc': wenc, 'tensors': [dict(t) for t in g.T], 'ops': ops, 'output': g.output['t'],
         'zslice': zslice, 'z_thresholds': thr, 'z_scale': z_scale, 'input_scale': 1 / 32, 'gpu_bytes': len(gpu), 'host_bytes': len(host)}
    return m, bytes(gpu), bytes(host)


# ------------------------------------------------------------------------------------------------ the integer model
HOST_FIELDS = {1: [('wsoff', 'ws'), ('wooff', 'wo'), ('alphaoff', 'a18'), ('betaoff', 'a18'), ('gammaoff', 'c'), ('muoff', 'a18')], 0: [('aoff', 'a18'), ('boff', 'a18')]}


def int8_model(mjson, wbin):
    m = json.loads(mjson); host = bytearray()
    for op in m['ops']:
        if op['op'] != 'cbn': continue
        C = m['tensors'][op['x']['t']]['c']
        size = {'ws': C * 256, 'wo': C * 256, 'a18': 18 * C * 4, 'c': C * 4}
        for f, kind in HOST_FIELDS[op['cond']]:
            n = size[kind]; at = len(host); host.extend(wbin[op[f]:op[f] + n]); host.extend(b'\0' * ((-len(host)) % 4)); op[f] = at
    m.update(format='p0pc0rn.dgmr', precision='int8', gpu_bytes=len(wbin), host_bytes=len(host), weights_sha256=sha(wbin))
    return m, wbin, bytes(host)


def write_pack(out, name, m, gpu, host, prec, lic, ver, src_note):
    os.makedirs(out, exist_ok=True)
    mb = json.dumps(m, separators=(',', ':')).encode()
    files = [(f'dgmr_{name}.json', mb, 'model'), (f'dgmr_{name}.bin', gpu, 'weights'), (f'dgmr_{name}_host.bin', host, 'tables')]
    shards = []
    for fn, data, kind in files:
        with open(os.path.join(out, fn), 'wb') as f: f.write(data)
        shards.append(shard(f'{name}.{kind}', fn, data, kind))
    with open(os.path.join(out, 'LICENSE'), 'wb') as f: f.write(lic)
    what = ('weights converted to 16-bit floating point' if prec == 'float' else 'weights quantised to 8-bit integers, activations to 8-bit, '
            'spectral and batch normalisation folded, integer kernels')
    notice = ('# Nowcast model: DeepMind DGMR\n\n'
              'The Deep Generative Model of Rainfall (DGMR) by DeepMind Technologies Limited, the 256x256 TF-Hub snapshot, '
              f'from {SOURCE}. Copyright 2021 DeepMind Technologies Limited. The model snapshot is licensed under the Creative Commons '
              'Attribution 4.0 International licence (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/; the full text is LICENSE '
              'beside this file).\n\n'
              f'Modified by the p0pc0rn project: {what}, and re-expressed as WebGPU kernels. Not the original files. Trained by DeepMind on '
              'UK radar; p0pc0rn runs it on US radar (NOAA MRMS) as an experiment. Not an official DeepMind or Google product.\n\n'
              f'Credit line: "{CREDIT}".\n\n{src_note}\n')
    with open(os.path.join(out, 'NOTICE.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(notice)
    readme = (f'# Nowcast model ({"floating point" if prec == "float" else "8-bit integer, low memory"}), p0pc0rn pack\n\n'
              'DeepMind DGMR for the Nowcast in p0pc0rn (nowcast/dgmr/): 4 radar frames (5 minutes apart, 1 km, 256 x 256) in, 18 frames '
              '(+5 to +90 minutes) of rain rate out. Files: the model description (op list and parameters), the GPU weights, and the '
              'latent-conditioning tables read on the CPU. See NOTICE.md and LICENSE (CC BY 4.0).\n')
    with open(os.path.join(out, 'README.md'), 'w', encoding='utf-8', newline='\n') as f: f.write(readme)
    man = {'format': 'pocketflux.pack', 'format_version': 1, 'pack_id': f'dgmr-nowcast-{name}-{ver}', 'pack_version': ver,
           'model': {'id': f'dgmr-nowcast-{name}', 'name': 'Nowcast', 'arch': f'dgmr-{name}', 'kind': 'nowcast', 'precision': prec,
                     'inputs': {'product': 'MRMS PrecipRate', 'frames': 4, 'every_min': 5, 'size': 256, 'km': 1},
                     'outputs': {'frames': 18, 'every_min': 5, 'first_min': 5, 'size': 256, 'km': 1, 'units': 'mm/h'}},
           'license': {'id': 'CC-BY-4.0', 'url': 'https://creativecommons.org/licenses/by/4.0/', 'files': ['LICENSE', 'NOTICE.md', 'README.md'],
                       'credit': CREDIT, 'attribution': ['DGMR: Copyright 2021 DeepMind Technologies Limited, CC BY 4.0'],
                       'modified': f'Modified by the p0pc0rn project: {what}.'},
           'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'packer': 'tools/nowcast_pack.py 1', 'shards': shards}
    b = json.dumps(man, indent=1).encode()
    with open(os.path.join(out, 'manifest.json'), 'wb') as f: f.write(b)
    return {'dir': out, 'bytes': sum(s['bytes'] for s in shards), 'manifest_sha256': sha(b), 'shards': {s['name']: s['bytes'] for s in shards}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tf-weights', required=True); ap.add_argument('--int8-model', required=True); ap.add_argument('--int8-weights', required=True)
    ap.add_argument('--license', required=True); ap.add_argument('--out', required=True); ap.add_argument('--wenc', default='f16', choices=['f16', 'f32'])
    ap.add_argument('--version', default=None)
    a = ap.parse_args()
    ver = a.version or time.strftime('%Y.%m.%d-1')
    lic = open(a.license, 'rb').read()
    mjson = open(a.int8_model, 'rb').read(); wbin = open(a.int8_weights, 'rb').read()
    mi, gi, hi = int8_model(mjson, wbin)
    W = dict(np.load(a.tf_weights))
    zslice = int(np.asarray(W[f"{G}Slice#1"]).reshape(-1)[1])
    mf, gf, hf = float_model(W, a.wenc, zslice, mi['z_thresholds'], mi['z_scale'])
    assert len(mf['ops']) == len(mi['ops']) and all(x['op'] == y['op'] and x['out'] == y['out'] for x, y in zip(mf['ops'], mi['ops'])), 'op lists differ'
    note = (f'Source files: tf_weights.npz sha256 {hashlib.sha256(open(a.tf_weights, "rb").read()).hexdigest()}; '
            f'integer weights sha256 {sha(wbin)}.')
    r8 = write_pack(a.out, 'int8', mi, gi, hi, 'int8', lic, ver, note)
    rf = write_pack(os.path.join(a.out, a.wenc), a.wenc, mf, gf, hf, 'float', lic, ver, note)
    print(json.dumps({'int8': r8, a.wenc: rf, 'version': ver}, indent=1))


if __name__ == '__main__':
    main()
