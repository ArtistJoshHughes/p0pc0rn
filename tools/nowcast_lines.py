"""nowcast_lines.py - the state lines, county lines and outline (coast, Great Lakes shore, Canada and Mexico borders) that the
rain map draws on the phone (nowcast/lines.js), for the lower 48 states and DC. Made from the US Census Bureau cartographic
boundary file for counties (public domain, US government work). Standard library only; the .shp and .dbf readers are below.

usage: python -I tools/nowcast_lines.py --dl <empty dir for the download> [--zip <a cb_*_us_county_*.zip already downloaded>]
       [--res auto|5m|20m] [--out nowcast/data/us_lines.bin] [--expect <tests/nowcast/fixtures/lines_expect.json>]
       auto = the 5m file when the result fits in 450 KB, else the 20m file. Tries the 2024 file, then 2023.

How: every county ring is quantised to 0.001 degree and split into segments, each keyed by its two end points (unordered), so
a border that two counties share is one segment. Used by one county = 'outline', by two counties of one state = 'county', by
counties of two states = 'state'. Segments chain into polylines that break where the class or the pair of counties changes,
and each polyline is simplified (Douglas-Peucker in local metres, end points kept so lines still meet).

us_lines.bin, little-endian: 'USL1', uint32 H, H bytes of UTF-8 JSON (spaces pad it so the binary part starts on a 4-byte
boundary), then for each class (outline, state, county) its n polylines: varint(points), the first point as zigzag varints
lon*1000 and lat*1000, then zigzag varint deltas for each later point. Varint = unsigned LEB128.
"""
import argparse, hashlib, io, json, math, os, struct, sys, urllib.request, zipfile

URL = 'https://www2.census.gov/geo/tiger/GENZ{y}/shp/cb_{y}_us_county_{r}.zip'
YEARS = (2024, 2023)
SKIP = {'02', '15', '60', '66', '69', '72', '78'}  # Alaska, Hawaii and the territories
Q = 1000                                            # 0.001 degree
CLASSES = ('outline', 'state', 'county')
TOL_M = {'outline': 200.0, 'state': 200.0, 'county': 250.0}
LIMIT = 450 * 1000                                  # bytes
M_PER_DEG = 6371008.8 * math.pi / 180
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


# ---- reading the shapefile --------------------------------------------------------------------------------------------------

def read_dbf(b):
    """rows of {field: text}; None for a deleted row"""
    n, hlen, rlen = struct.unpack_from('<IHH', b, 4)
    fields, off, pos = [], 1, 32
    while b[pos] != 0x0D:
        name = b[pos:pos + 11].split(b'\0')[0].decode('ascii')
        fields.append((name, off, b[pos + 16]))
        off += b[pos + 16]
        pos += 32
    rows = []
    for i in range(n):
        r = b[hlen + i * rlen:hlen + (i + 1) * rlen]
        rows.append(None if r[:1] == b'*' else {k: r[o:o + w].decode('utf-8', 'replace').strip() for k, o, w in fields})
    return rows


def read_shp(b):
    """one list of rings per record; a ring is a list of (lon, lat). Polygon (type 5) and null records only."""
    if struct.unpack_from('>i', b, 0)[0] != 9994:
        raise ValueError('not a .shp file')
    end = min(len(b), struct.unpack_from('>i', b, 24)[0] * 2)
    pos, out = 100, []
    while pos + 12 <= end:
        clen = struct.unpack_from('>i', b, pos + 4)[0] * 2
        c = pos + 8
        kind = struct.unpack_from('<i', b, c)[0]
        if kind == 0:
            out.append([])
        elif kind == 5:
            nparts, npts = struct.unpack_from('<ii', b, c + 36)
            parts = struct.unpack_from('<%di' % nparts, b, c + 44) + (npts,)
            xy = struct.unpack_from('<%dd' % (2 * npts), b, c + 44 + 4 * nparts)
            out.append([[(xy[2 * j], xy[2 * j + 1]) for j in range(parts[k], parts[k + 1])] for k in range(nparts)])
        else:
            raise ValueError('shape type %d (only polygons expected)' % kind)
        pos = c + clen
    return out


def load_counties(zbytes):
    """[(statefp, geoid, name, rings)] for the lower 48 and DC"""
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    names = z.namelist()
    shp = next(n for n in names if n.lower().endswith('.shp'))
    dbf = next(n for n in names if n.lower().endswith('.dbf'))
    shapes, rows = read_shp(z.read(shp)), read_dbf(z.read(dbf))
    if len(shapes) != len(rows):
        raise ValueError('.shp and .dbf disagree: %d vs %d records' % (len(shapes), len(rows)))
    return [(r['STATEFP'], r['GEOID'], r.get('NAME', ''), s) for r, s in zip(rows, shapes)
            if r and r['STATEFP'] not in SKIP and s]


# ---- topology ---------------------------------------------------------------------------------------------------------------

def quant(v):
    return math.floor(v * Q + 0.5)


def build_arcs(counties):
    """[(class, [(x, y) ints])]: each shared border once, chained, not yet simplified; plus a dict of oddities"""
    node, xy = {}, []                       # quantised point -> node id
    users = {}                              # segment (a, b), a < b -> {county: times used}
    for ci, (_, _, _, rings) in enumerate(counties):
        for ring in rings:
            r = []
            for lon, lat in ring:
                p = (quant(lon), quant(lat))
                if not r or r[-1] != p:
                    r.append(p)
            if len(r) > 1 and r[0] == r[-1]:
                r.pop()
            if len(r) < 2:
                continue
            ids = []
            for p in r:
                i = node.get(p)
                if i is None:
                    i = node[p] = len(xy)
                    xy.append(p)
                ids.append(i)
            for k in range(len(ids)):
                a, b = ids[k - 1], ids[k]
                key = (a, b) if a < b else (b, a)
                u = users.setdefault(key, {})
                u[ci] = u.get(ci, 0) + 1
    odd = {'spur_segments': 0, 'segments_3plus': 0}
    segs, adj = [], {}
    for (a, b), u in users.items():
        lab = tuple(sorted(c for c, n in u.items() if n % 2))  # a county running over a segment twice is a spur: drop it
        if not lab:
            odd['spur_segments'] += 1
            continue
        if len(lab) > 2:
            odd['segments_3plus'] += 1
        s = len(segs)
        segs.append((a, b, lab))
        adj.setdefault(a, []).append(s)
        adj.setdefault(b, []).append(s)
    brk = {n for n, s in adj.items() if len(s) != 2 or segs[s[0]][2] != segs[s[1]][2]}
    used = bytearray(len(segs))

    def walk(start, s):
        path, cur = [start], start
        while True:
            used[s] = 1
            a, b, _ = segs[s]
            cur = b if a == cur else a
            path.append(cur)
            if cur in brk or cur == start:
                return path
            s0, s1 = adj[cur]
            s = s1 if s0 == s else s0

    chains = []
    for n in adj:                           # open chains, node to node
        if n in brk:
            for s in adj[n]:
                if not used[s]:
                    chains.append((segs[s][2], walk(n, s)))
    for s in range(len(segs)):              # closed loops with no node on them (islands, enclaves)
        if not used[s]:
            chains.append((segs[s][2], walk(segs[s][0], s)))
    arcs = []
    for lab, path in chains:
        if len(lab) == 1:
            cls = 'outline'
        else:
            cls = 'county' if len({counties[c][0] for c in lab}) == 1 else 'state'
        arcs.append((cls, [xy[i] for i in path]))
    odd['nodes'] = len(xy)
    odd['segments'] = len(segs)
    return arcs, odd


# ---- simplify and write -----------------------------------------------------------------------------------------------------

def simplify(pts, tol_m):
    """Douglas-Peucker in a local equirectangular metric, first and last point kept"""
    n = len(pts)
    if n < 3:
        return pts
    lat0 = sum(p[1] for p in pts) / n / Q
    kx, ky = M_PER_DEG / Q * math.cos(math.radians(lat0)), M_PER_DEG / Q
    xs = [p[0] * kx for p in pts]
    ys = [p[1] * ky for p in pts]
    keep = bytearray(n)
    keep[0] = keep[-1] = 1
    tol2 = tol_m * tol_m
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay, dx, dy = xs[i], ys[i], xs[j] - xs[i], ys[j] - ys[i]
        dd = dx * dx + dy * dy
        best, bk = -1.0, -1
        for k in range(i + 1, j):
            px, py = xs[k] - ax, ys[k] - ay
            t = (px * dx + py * dy) / dd if dd else 0.0
            if t > 1.0:
                t = 1.0
            elif t < 0.0:
                t = 0.0
            ex, ey = px - t * dx, py - t * dy
            d = ex * ex + ey * ey
            if d > best:
                best, bk = d, k
        if bk > 0 and best > tol2:
            keep[bk] = 1
            stack.append((i, bk))
            stack.append((bk, j))
    if pts[0] == pts[-1] and sum(keep) < 4:     # a small closed loop: keep a triangle, not a dot or a dash drawn twice
        far = max(range(1, n - 1), key=lambda k: (xs[k] - xs[0]) ** 2 + (ys[k] - ys[0]) ** 2)
        dx, dy = xs[far] - xs[0], ys[far] - ys[0]
        side = max((k for k in range(1, n - 1) if k != far), key=lambda k: abs((xs[k] - xs[0]) * dy - (ys[k] - ys[0]) * dx))
        keep = bytearray(n)
        keep[0] = keep[-1] = keep[far] = keep[side] = 1
    return [p for p, k in zip(pts, keep) if k]


def undouble(lines):
    """two polylines between the same two nodes that both came out as one straight segment would draw twice: bend one"""
    seen, bent = set(), 0
    for cls, full, pts in lines:
        if len(pts) == 2:
            key = (min(pts[0], pts[1]), max(pts[0], pts[1]))
            if key in seen and len(full) > 2:
                pts.insert(1, full[len(full) // 2])
                bent += 1
            seen.add(key)
    return bent


def uv(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zz(n):
    return n << 1 if n >= 0 else (-n << 1) - 1


def encode(by_cls, source, sha):
    xs = [p[0] for c in CLASSES for pts in by_cls[c] for p in pts]
    ys = [p[1] for c in CLASSES for pts in by_cls[c] for p in pts]
    head = {'v': 1, 'q': Q, 'classes': list(CLASSES), 'counts': [len(by_cls[c]) for c in CLASSES],
            'bbox': [round(min(xs) / Q, 3), round(min(ys) / Q, 3), round(max(xs) / Q, 3), round(max(ys) / Q, 3)],
            'source': source, 'sha256': sha, 'made': 'tools/nowcast_lines.py'}
    h = json.dumps(head, separators=(',', ':')).encode('utf-8')
    h += b' ' * (-len(h) % 4)
    out = bytearray(b'USL1' + struct.pack('<I', len(h)) + h)
    for c in CLASSES:
        for pts in by_cls[c]:
            uv(len(pts), out)
            px = py = 0
            for x, y in pts:
                uv(zz(x - px), out)
                uv(zz(y - py), out)
                px, py = x, y
    return bytes(out), head


def make(zbytes, source):
    sha = hashlib.sha256(zbytes).hexdigest()
    counties = load_counties(zbytes)
    arcs, odd = build_arcs(counties)
    lines = [(cls, pts, simplify(pts, TOL_M[cls])) for cls, pts in arcs]
    odd['bent'] = undouble(lines)
    by_cls = {c: [] for c in CLASSES}
    for cls, _, pts in lines:
        by_cls[cls].append(pts)
    blob, head = encode(by_cls, source, sha)
    stats = {'counties': len(counties), 'states': len({c[0] for c in counties}),
             'points_in': sum(len(p) for _, p in arcs), **odd}
    return blob, head, by_cls, stats


def expect_of(blob, head, by_cls):
    return {'bytes': len(blob), 'sha256_file': hashlib.sha256(blob).hexdigest(),
            'counts': {c: len(by_cls[c]) for c in CLASSES},
            'points': {c: sum(len(p) for p in by_cls[c]) for c in CLASSES},
            'sumLon': {c: sum(x for p in by_cls[c] for x, _ in p) for c in CLASSES},
            'sumLat': {c: sum(y for p in by_cls[c] for _, y in p) for c in CLASSES},
            'bbox': head['bbox'], 'source': head['source'], 'sha256': head['sha256']}


def fetch(res, dl):
    """(zip bytes, url): the newest year that the Census site has"""
    last = None
    for y in YEARS:
        url = URL.format(y=y, r=res)
        dest = os.path.join(dl, url.rsplit('/', 1)[1])
        if os.path.exists(dest):
            with open(dest, 'rb') as f:
                return f.read(), url
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                b = r.read()
        except Exception as e:  # 404 for a year not published: try the one before
            last = e
            continue
        with open(dest, 'wb') as f:
            f.write(b)
        return b, url
    raise SystemExit('no county file for %s: %s' % (res, last))


README = """us_lines.bin: state lines, county lines and the outline (coast, Great Lakes shore, Canada and Mexico borders) of the lower 48 states and DC, for the rain map (read by nowcast/lines.js).
Source: {url} (sha256 {sha}).
This is US Census Bureau cartographic boundary data, a US government work in the public domain, simplified to about 200-250 m and 0.001 degree.
Made by tools/nowcast_lines.py.
"""


def main():
    ap = argparse.ArgumentParser(description='bundled US lines for the rain map')
    ap.add_argument('--dl', help='folder for the downloaded zip (a new, empty one)')
    ap.add_argument('--zip', help='a Census county zip already on disk (its file name gives the year and scale)')
    ap.add_argument('--res', default='auto', choices=['auto', '5m', '20m'])
    ap.add_argument('--out', default=os.path.join(REPO, 'nowcast', 'data', 'us_lines.bin'))
    ap.add_argument('--expect', help='also write the numbers the node test checks to this JSON file')
    a = ap.parse_args()
    if a.zip:
        name = os.path.basename(a.zip)
        y, r = name.split('_')[1], name.rsplit('_', 1)[1].split('.')[0]
        with open(a.zip, 'rb') as f:
            tries = [(f.read(), URL.format(y=y, r=r))]
    else:
        if not a.dl:
            ap.error('--dl or --zip is needed')
        os.makedirs(a.dl, exist_ok=True)
        tries = [fetch('5m' if a.res == 'auto' else a.res, a.dl)]
    while True:
        zb, url = tries[-1]
        blob, head, by_cls, stats = make(zb, url)
        if len(blob) <= LIMIT or a.res != 'auto' or '_20m' in url or a.zip:
            break
        print('%s gives %d bytes (over %d): trying the 20m file' % (url, len(blob), LIMIT), file=sys.stderr)
        tries.append(fetch('20m', a.dl))
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'wb') as f:
        f.write(blob)
    with open(os.path.join(os.path.dirname(os.path.abspath(a.out)), 'README.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(README.format(url=url, sha=head['sha256']))
    exp = expect_of(blob, head, by_cls)
    if a.expect:
        os.makedirs(os.path.dirname(os.path.abspath(a.expect)), exist_ok=True)
        with open(a.expect, 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(exp, indent=1) + '\n')
    print(json.dumps({**exp, 'fits': len(blob) <= LIMIT, 'stats': stats}, indent=1))
    if len(blob) > LIMIT:
        raise SystemExit('over the %d byte target' % LIMIT)


if __name__ == '__main__':
    main()
