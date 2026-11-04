"""gaz_pack.py - v4 (weather in chat): packs the US Census Bureau Gazetteer files (public domain) into the two small tables Juli reads
on a weather question (assistant/places.js), so a place or a ZIP becomes coordinates on the phone with no geocoder online.

usage: python -I tools/gaz_pack.py <Gaz_place_national.txt> <Gaz_zcta_national.txt> <sub-est2024.csv> <out dir: assistant/data>
(the 2025 Gazetteer place and ZCTA files, and the 2024 city and town population estimates: all US Census Bureau, public domain)

places_us.txt.gz  one "@ST" line per state (USPS code), then a line per place, south to north: name <TAB> lat*100 <TAB> lon*100
                  <TAB> weight, lat and lon as the change from the line before (from 0 after each "@ST" line); weight = its people in
                  thousands (2024 estimate), or for a census-designated place (no estimate) its land in km2. The name without its
                  kind ("Portland city" -> "Portland"); a consolidated city also under its first part ("Nashville-Davidson
                  metropolitan government (balance)" -> "Nashville-Davidson" and "Nashville")
zcta_us.bin.gz    "ZC1\\0", the row count (u32 LE), then per ZIP (sorted): varint(ZIP - previous ZIP), zigzag varint(lat*100 - previous),
                  zigzag varint(lon*100 - previous). 0.01 degree (about 1 km) is all a forecast needs, and all that goes to it.
"""
import gzip, io, re, struct, sys

SUFFIX = re.compile(r'\s+(?:city and borough|consolidated government \(balance\)|metropolitan government \(balance\)|metro government \(balance\)|'
                    r'unified government \(balance\)|unified government|consolidated government|metropolitan government|metro government|'
                    r'urban county|city \(balance\)|town \(balance\)|\(balance\)|municipality|borough|city|town|township|village|CDP|comunidad|'
                    r'zona urbana|plantation|corporation)$')

def clean(name):
    n = name
    for _ in range(3):
        m = SUFFIX.search(n)
        if not m: break
        n = n[:m.start()]
    n = re.sub(r'^Urban\s+', '', n).strip()
    return n

def population(path):
    import csv
    pop = {}
    with open(path, encoding='latin-1') as f:
        for r in csv.DictReader(f):
            if r['SUMLEV'] == '162': pop[r['STATE'] + r['PLACE']] = int(r['POPESTIMATE2024'] or 0)
    return pop

def places(path, pop):
    rows = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        head = f.readline().rstrip('\n').split('|')
        ix = {k.strip(): i for i, k in enumerate(head)}
        for line in f:
            c = line.rstrip('\n').split('|')
            st, raw = c[ix['USPS']], c[ix['NAME']]
            lat, lon = round(float(c[ix['INTPTLAT']]) * 100), round(float(c[ix['INTPTLONG']]) * 100)
            g = c[ix['GEOID']]
            km2 = round(int(c[ix['ALAND']]) / 1e6) if g not in pop else round(pop[g] / 1000)   # the weight (see above)
            base = clean(raw)
            names = {base}
            if re.search(r'government|urban county|\(balance\)', raw) and re.search(r'[-/]', base):
                names.add(re.split(r'[-/]', base)[0].strip())
            for n in names:
                if not n: continue
                k = (st, n)
                if k not in rows or rows[k][2] < km2: rows[k] = (lat, lon, km2)   # the same name twice in a state: the larger
    out = io.StringIO()
    out.write('# p0pc0rn US places: US Census Bureau Gazetteer (places), public domain\n')
    for st in sorted({k[0] for k in rows}):
        out.write('@' + st + '\n')
        pa = pb = 0
        for (s, n) in sorted((k for k in rows if k[0] == st), key=lambda k: (rows[k][0], rows[k][1], k[1])):
            lat, lon, km2 = rows[(s, n)]
            out.write(f'{n}\t{lat - pa}\t{lon - pb}\t{km2}\n')
            pa, pb = lat, lon
    return out.getvalue(), len(rows)

def varint(v, b):
    while True:
        x = v & 0x7f; v >>= 7
        if v: b.append(x | 0x80)
        else: b.append(x); return

def zcta(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        head = f.readline().rstrip('\n').split('|')
        ix = {k.strip(): i for i, k in enumerate(head)}
        for line in f:
            c = line.rstrip('\n').split('|')
            rows.append((int(c[ix['GEOID']]), round(float(c[ix['INTPTLAT']]) * 100), round(float(c[ix['INTPTLONG']]) * 100)))
    rows.sort()
    b = bytearray(b'ZC1\0' + struct.pack('<I', len(rows)))
    pz = plat = plon = 0
    zz = lambda v: (v << 1) ^ (v >> 63)
    for z, la, lo in rows:
        varint(z - pz, b); varint(zz(la - plat), b); varint(zz(lo - plon), b)
        pz, plat, plon = z, la, lo
    return bytes(b), len(rows)

if __name__ == '__main__':
    pl, zc, pe, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    txt, n = places(pl, population(pe))
    raw = txt.encode('utf-8'); gz = gzip.compress(raw, 9, mtime=0)
    open(out + '/places_us.txt.gz', 'wb').write(gz)
    print(f'places: {n} names, {len(raw)} bytes, {len(gz)} gzipped')
    zb, m = zcta(zc); zg = gzip.compress(zb, 9, mtime=0)
    open(out + '/zcta_us.bin.gz', 'wb').write(zg)
    print(f'zcta: {m} ZIPs, {len(zb)} bytes packed, {len(zg)} gzipped')
