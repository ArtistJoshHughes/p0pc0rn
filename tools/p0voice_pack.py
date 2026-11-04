"""p0voice_pack.py - Juli's own voice (p0voice, stage 1: text + mood tag -> 24 kHz speech; trained by the p0pc0rn project) -> the phone's
pack (pocketflux.pack/1) for engine/p0voice/ (ui/voiceout.js reads it).

  python tools/p0voice_pack.py <p0voice.p0v> <p0voice_lexicon.bin> <g2p.p0v> <cmudict LICENSE> <out dir> [--version 2026.11.03-2]

The three files are the speech engine's own exports (the pack adds nothing to them; the model's speaker table is cut to Juli's row):
  - p0voice.p0v: the acoustic model (OT-CFM: a 6-layer RoPE transformer encoder, durations, a conv-only vector-field decoder) and the
    Vocos-style vocoder, int8 per output channel ("P0V1": a JSON header, then 64-byte-aligned tensors); its config carries the
    style table (the mood words) and the speaker table with Juli only (speaker 0, her pace 1.115): the research voices the engine
    was trained with stay out of the app's pack;
  - p0voice_lexicon.bin: the pronunciations ("P0LX"), from CMUdict (BSD-2-Clause) plus the game's own words;
  - g2p.p0v: the learned letters-to-sounds model for words the lexicon does not have (trained by us on CMUdict).
One shard per file (p0voice.model, p0voice.lexicon, p0voice.g2p). manifest.json: shards with sha256 per file and per 16 MiB chunk (the
phone verifies every chunk); LICENSE.md (p0pc0rn's own licence: Josh Hughes owns the engine and the weights), LICENSE-cmudict.txt
(CMUdict's BSD-2-Clause notice, which the lexicon and the G2P carry), NOTICE.md and README.md beside it.
Nothing is uploaded anywhere: the pack is written to <out dir>. Needs only Python 3."""
import argparse, hashlib, json, os, struct, time

CHUNK = 16 * 1024 * 1024
HERE = os.path.dirname(os.path.abspath(__file__))


def sha(b): return hashlib.sha256(b).hexdigest()


def p0v_config(b, magic):
    if b[:4] != magic: raise SystemExit(f'not a {magic.decode()} file')
    n = struct.unpack('<I', b[4:8])[0]
    h = json.loads(b[8:8 + n].decode('utf-8'))
    return h.get('config', h)


def keep_speakers(b, n):
    """a P0V1 model with only its first n speakers (the am.spk.weight rows; config speakers, speaker_pace, n_spk); every other tensor's
    bytes as they are, laid out again 64-byte aligned the way train/export_pack.py writes them"""
    hl = struct.unpack('<I', b[4:8])[0]
    h = json.loads(b[8:8 + hl].decode('utf-8')); base = 8 + hl
    C = h['config']
    if n < 1 or n > len(C['speakers']): raise SystemExit(f'--speakers {n}: the model has {len(C["speakers"])}')
    C['speakers'] = C['speakers'][:n]; C['speaker_pace'] = C['speaker_pace'][:n]; C['n_spk'] = n
    blob, table, off, cut = [], [], 0, False
    for t in h['tensors']:
        d = b[base + t['offset']:base + t['offset'] + t['nbytes']]; shape = list(t['shape'])
        if t['name'] == 'am.spk.weight':
            row = t['nbytes'] // shape[0]; d = d[:row * n]; shape[0] = n; cut = True
        pad = (-off) % 64; blob.append(bytes(pad)); off += pad
        table.append({'name': t['name'], 'dtype': t['dtype'], 'shape': shape, 'offset': off, 'nbytes': len(d)})
        blob.append(d); off += len(d)
    if not cut: raise SystemExit('no speaker table (am.spk.weight) in the model')
    hdr = json.dumps({'version': h['version'], 'config': C, 'tensors': table}).encode()
    hdr += b' ' * ((-(8 + len(hdr))) % 64)
    return b'P0V1' + struct.pack('<I', len(hdr)) + hdr + b''.join(blob)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model'); ap.add_argument('lexicon'); ap.add_argument('g2p'); ap.add_argument('cmudict_license'); ap.add_argument('out')
    ap.add_argument('--version', default=None)
    ap.add_argument('--speakers', type=int, default=1, help="speakers kept from the model's table (1 = Juli only: the app's pack)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if os.listdir(a.out): raise SystemExit(f'{a.out} is not empty')
    files = [('p0voice.model', 'p0voice.p0v', 'weights', a.model), ('p0voice.lexicon', 'p0voice_lexicon.bin', 'lexicon', a.lexicon),
             ('p0voice.g2p', 'g2p.p0v', 'weights', a.g2p)]
    shards, blobs = [], {}
    for name, file, kind, src in files:
        with open(src, 'rb') as f: b = f.read()
        if name == 'p0voice.model':
            if (p0v_config(b, b'P0V1').get('speakers') or [''])[0] != 'juli_vd2': raise SystemExit('speaker 0 is not Juli (juli_vd2)')
            b = keep_speakers(b, a.speakers)
        blobs[name] = b
        with open(os.path.join(a.out, file), 'wb') as f: f.write(b)
        shards.append({'name': name, 'file': file, 'kind': kind, 'bytes': len(b), 'sha256': sha(b), 'chunk_bytes': CHUNK,
                       'chunk_sha256': [sha(b[i:i + CHUNK]) for i in range(0, len(b), CHUNK)]})
    C = p0v_config(blobs['p0voice.model'], b'P0V1')
    G = p0v_config(blobs['p0voice.g2p'], b'P0V1')
    if blobs['p0voice.lexicon'][:4] != b'P0LX': raise SystemExit('not a P0LX lexicon')
    if G.get('kind') != 'g2p': raise SystemExit('the third file is not a G2P pack')

    with open(a.cmudict_license, 'rb') as f: lic = f.read()
    if b'Carnegie Mellon University' not in lic: raise SystemExit("that is not CMUdict's LICENSE")
    with open(os.path.join(a.out, 'LICENSE-cmudict.txt'), 'wb') as f: f.write(lic)
    with open(os.path.join(HERE, '..', 'LICENSE.md'), 'rb') as f: own = f.read()
    if not own.startswith(b'# p0pc0rn'): raise SystemExit("the app's LICENSE.md is not p0pc0rn's licence")
    with open(os.path.join(a.out, 'LICENSE.md'), 'wb') as f: f.write(own)
    nl = chr(10)
    notice = ("# Juli's voice (p0voice v3)" + nl + nl +
              "p0pc0rn's own text-to-speech, made by the p0pc0rn project (Josh Hughes): the acoustic model, the vocoder and the "
              "letters-to-sounds model were trained from scratch by us. No real person's voice was used: the training speech was made "
              "with Qwen3-TTS (Qwen3-TTS-12Hz-1.7B-VoiceDesign designed the voices from written descriptions, Qwen3-TTS-12Hz-0.6B-Base "
              "spoke the lines; Apache-2.0, which puts no terms on what the models make), reading public-domain texts (Project Gutenberg) "
              "and lines we wrote. Josh Hughes owns the engine and the weights; they are licensed under p0pc0rn's own licence "
              "(LICENSE.md beside this file)." + nl + nl +
              "The pronunciations (p0voice_lexicon.bin) come from the CMU Pronouncing Dictionary, and the letters-to-sounds model "
              '(g2p.p0v) was trained on it: "Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved." under the '
              "BSD 2-Clause licence; its full notice is LICENSE-cmudict.txt beside this file. The game's own words were added by us." + nl)
    with open(os.path.join(a.out, 'NOTICE.md'), 'w', encoding='utf-8', newline=nl) as f: f.write(notice)
    files_doc = __doc__.split("cut to Juli's row):" + nl)[1].split('One shard per file')[0].rstrip().split(nl)
    readme = ("# Juli's voice (p0pc0rn pack)" + nl + nl + "p0voice v3 for p0pc0rn's voice mode (engine/p0voice/, ui/voiceout.js): text + a mood "
              "tag -> 24 kHz speech on the phone's GPU (WebGPU), 4 steps. The files, as the speech engine exported them:" + nl + nl
              + nl.join(l[2:] if l.startswith('  ') else l for l in files_doc)
              + nl + nl + "See NOTICE.md, LICENSE.md (p0pc0rn's licence) and LICENSE-cmudict.txt (CMUdict, BSD-2-Clause)." + nl)
    with open(os.path.join(a.out, 'README.md'), 'w', encoding='utf-8', newline=nl) as f: f.write(readme)

    ver = a.version or time.strftime('%Y.%m.%d-1')
    m = {
        'format': 'pocketflux.pack', 'format_version': 1, 'pack_id': f'p0voice-juli-{ver}', 'pack_version': ver,
        'model': {'id': 'p0voice-juli', 'name': "Juli's voice", 'arch': 'p0voice-otcfm-vocos', 'kind': 'tts', 'version': 'v3',
                  'sample_rate': C.get('sr'), 'steps': (C.get('infer') or {}).get('steps'), 'speaker': 0, 'speakers': C.get('speakers'),
                  'speaker_pace': C.get('speaker_pace'), 'styles': [s for s in C.get('styles', []) if not s.startswith('spare')],
                  'g2p': {'layers': G.get('layers'), 'd': G.get('d')}},
        'encodings': {'p0v1': '"P0V1", u32 header length, JSON header, 64-byte-aligned tensors; int8 matrices with an f32 scale per output '
                              'channel, f16 / f32 tables and vectors', 'p0lx': '"P0LX" compact lexicon (engine/p0voice/p0v_lexicon.js)'},
        'license': {'id': "p0pc0rn Non-Commercial License (the engine and the weights, Josh Hughes) + BSD-2-Clause (CMUdict: the lexicon, the G2P's training data)",
                    'files': ['LICENSE.md', 'LICENSE-cmudict.txt', 'NOTICE.md', 'README.md'], 'notice': 'NOTICE.md',
                    'credit': "Juli's voice: p0voice by the p0pc0rn project; pronunciations from the CMU Pronouncing Dictionary (BSD-2-Clause)",
                    'attribution': ['CMU Pronouncing Dictionary: Copyright (C) 1993-2015 Carnegie Mellon University, BSD-2-Clause']},
        'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'packer': 'tools/p0voice_pack.py 2',
        'shards': shards, 'tensors': {},
    }
    mb = json.dumps(m, indent=1, ensure_ascii=False).encode('utf-8')
    with open(os.path.join(a.out, 'manifest.json'), 'wb') as f: f.write(mb)
    print(json.dumps({'out': a.out, 'pack_version': ver, 'shards': len(shards), 'bytes': sum(x['bytes'] for x in shards),
                      'speakers': C.get('speakers'), 'manifest_sha256': sha(mb), 'files': {s['file']: s['sha256'] for s in shards}}, indent=1))


if __name__ == '__main__':
    main()
