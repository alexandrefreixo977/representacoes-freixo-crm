import json, re, collections
import pymupdf
P = re.compile(r'^\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*€?\s*$')
REF = re.compile(r'(?:Ref\.?\s*)?([0-9A-Z][0-9A-Za-z./\-]*\d[0-9A-Za-z./\-]*)')
idx = {k.upper(): k for k in json.load(open('/tmp/claude-0/dg/index.json'))}
cat = json.load(open('/tmp/claude-0/dg/rows.json'))
d = pymupdf.open('/mnt/project-files/PROMO2026PT.pdf')
res, problems = {}, []
f = lambda v: float(v.replace('.', '').replace(',', '.'))
for pn in range(len(d)):
    sp = []
    for b in d[pn].get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    x0, y0, x1, y1 = s['bbox']
                    sp.append(dict(t=t, x0=x0, x1=x1, y=(y0 + y1) / 2, size=s['size'], font=s['font']))
    prices = [dict(s, v=P.match(s['t']).group(1)) for s in sp if P.match(s['t']) and 'Bold' in s['font']]
    small = [p for p in prices if p['size'] < 8.9]
    big = [p for p in prices if p['size'] >= 8.9]
    refs = []
    for s in sp:
        if s['size'] > 9.6 or s['size'] < 6.5 or 'Bold' not in s['font']: continue
        toks = re.findall(r'[0-9A-Za-z][0-9A-Za-z./\-]*\d[0-9A-Za-z./\-]*', s['t'])
        for t in toks:
            t = t.rstrip('*.')
            if t.upper() in idx:
                refs.append(dict(s, ref=idx[t.upper()]))
            elif 'Ref' in s['t'] and re.match(r'^\d{3,5}-[0-9A-Za-z]+', t):
                refs.append(dict(s, ref=t))
    used = set()
    for sm in small:
        cand = [b for b in big if abs(b['y'] - sm['y']) < 5 and 0 < b['x0'] - sm['x1'] < 120 and id(b) not in used]
        if not cand:
            problems.append((pn + 1, 'sem promo', sm['t'])); continue
        bg = min(cand, key=lambda b: b['x0'] - sm['x1']); used.add(id(bg))
        cx = (sm['x0'] + bg['x1']) / 2
        near = [r for r in refs if -5 < sm['y'] - r['y'] < 45 and abs((r['x0'] + r['x1']) / 2 - cx) < 230]
        def dist(r):
            if abs(r['y'] - sm['y']) < 5 and r['x1'] <= sm['x0'] + 2:
                return sm['x0'] - r['x1']
            return abs((r['x0'] + r['x1']) / 2 - cx) + 3 * abs(sm['y'] - r['y'])
        match = [r for r in near if r['ref'] in cat and abs(f(cat[r['ref']][0]['price']) - f(sm['v'])) < 0.01]
        if match:
            r = min(match, key=dist)
        else:
            newr = [r for r in near if r['ref'] not in cat]
            if not newr:
                problems.append((pn + 1, 'PVP não confere', sm['t'], bg['t'], sorted({r['ref'] for r in near}, key=lambda x: x)[:6])); continue
            r = min(newr, key=dist)
        res.setdefault(r['ref'], []).append(dict(page=pn + 1, pvp=sm['v'], promo=bg['v']))
f = lambda v: float(v.replace('.', '').replace(',', '.'))
ok = mism = new = 0; mm = []
for r, L in res.items():
    c = cat.get(r)
    if not c: new += 1; continue
    if any(abs(f(x['pvp']) - f(c[0]['price'])) < 0.01 for x in L): ok += 1
    else: mism += 1; mm.append((r, c[0]['price'], L))
print('refs', len(res), 'ok', ok, 'mismatch', mism, 'novos', new)
print('problems', len(problems), problems[:40])
print(mm[:40])
print('novos:', [(r, L) for r, L in res.items() if r not in cat][:60])
print('dup', [(r, L) for r, L in res.items() if len(set(x['promo'] for x in L)) > 1][:20])
json.dump(res, open('/tmp/claude-0/dg/promo.json', 'w'), ensure_ascii=False)
