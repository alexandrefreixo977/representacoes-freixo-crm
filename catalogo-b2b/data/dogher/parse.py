import json, re, sys, collections
import pymupdf
PRICE = re.compile(r'^(\d{1,3}(?:\.\d{3})*,\d{2})\s*(\*?)$')
CODE = re.compile(r'^[0-9A-Z][0-9A-Z/]{1,9}$')
idx0 = json.load(open('/tmp/claude-0/dg/index.json'))
idx = {k.upper(): k for k in idx0}
d = pymupdf.open('/mnt/project-files/DOGHER_2025-26_Catalogo-PT.pdf')
out = {}
codetitle = {}
def spans_of(p):
    spans = []
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    x0, y0, x1, y1 = s['bbox']
                    spans.append(dict(t=t, x0=x0, x1=x1, y=(y0 + y1) / 2, size=s['size'], font=s['font']))
    return spans
def merge(hl):
    hl = sorted(hl, key=lambda q: q['x0']); res = []
    for q in hl:
        if res and q['x0'] - res[-1]['x1'] < 4:
            res[-1] = dict(res[-1], t=res[-1]['t'] + ' ' + q['t'], x1=q['x1'])
        else:
            res.append(dict(q))
    return res
for pn in range(len(d)):
    spans = spans_of(d[pn])
    section = ' '.join(s['t'] for s in sorted([s for s in spans if s['size'] > 13 and s['y'] < 75 and 'Bold' in s['font']], key=lambda s: s['x0']))
    sub = ' '.join(s['t'] for s in spans if 'Heavy' in s['font'] and 'Obl' not in s['font'] and 9.5 < s['size'] < 11 and 70 < s['y'] < 100)
    heads = [s for s in spans if 8.8 < s['size'] < 13 and 'HeavyObl' in s['font'] and CODE.match(s['t']) and s['y'] > 60]
    titles = [s for s in spans if 9.4 < s['size'] < 10.6 and s['font'].endswith('Medium') and s['y'] > 100]
    for h in heads:
        tl = [s for s in sorted(titles, key=lambda s: (round(s['y']), s['x0'])) if -9 < s['y'] - h['y'] < 22 and h['x1'] < s['x0'] < h['x1'] + 60]
        # títulos em 2 linhas: juntar as linhas a partir da mesma coluna
        if tl:
            x = tl[0]['x0']
            h['title'] = ' '.join(s['t'] for s in tl if abs(s['x0'] - x) < 40 or s['x0'] > x)
            h['title'] = re.sub(r'\s+', ' ', h['title']).strip()
            codetitle.setdefault(h['t'], h['title'])
        else:
            h['title'] = ''
    heads = [h for h in heads if h['title']]
    prices = []
    for s in spans:
        m = PRICE.match(s['t'])
        if m and 'Heavy' in s['font']:
            prices.append(dict(s, price=m.group(1), star=bool(m.group(2))))
    parts = [s for s in spans if s['t'].startswith('Part N')]
    page_recs = []
    for s in spans:
        rs = s['t'].rstrip('* ').strip()
        star_ref = s['t'] != rs
        if rs.upper() not in idx:
            continue
        r = idx[rs.upper()]
        if False or not (6.5 <= s["size"] <= 9.5) or 'Heavy' not in s['font']:
            continue
        ph = [q for q in parts if q['y'] < s['y'] and abs(q['x0'] - s['x0']) < 30]
        cand = [q for q in prices if abs(q['y'] - s['y']) < 4.5 and q['x0'] > s['x1'] - 2]
        if not cand:
            continue
        pr = min(cand, key=lambda q: q['x0'])
        if pr['x0'] - s['x1'] > 160:
            continue
        pre = r.split('-')[0]
        hs = [h for h in heads if h['t'] == pre]
        if hs:
            above = [h for h in hs if h['y'] < s['y']]
            h = max(above or hs, key=lambda h: (h['y'], h['x0']) if above else (-abs(h['y'] - s['y']),))
        else:
            hs = [h for h in heads if h['y'] < s['y'] and h['x0'] <= s['x0'] + 10]
            h = max(hs, key=lambda h: (round(h['y'] / 5), h['x0'])) if hs else None
        hb = [h['x0'], h['y']] if h else None
        if h:
            fam, title = h['t'], h['title']
        elif pre in codetitle:
            fam, title = pre, codetitle[pre]
        else:
            tt = [t for t in titles if t['y'] < s['y'] and t['x0'] <= s['x0'] + 10]
            t = max(tt, key=lambda t: (round(t['y'] / 5), t['x0'])) if tt else None
            fam, title = '', (t['t'] if t else '')
        attrs = []
        py = None
        if ph:
            P = max(ph, key=lambda q: q['y']); py = P['y']
            left_bound = max([q['x1'] for q in spans if abs(q['y'] - P['y']) < 5 and q['t'] == '€' and q['x1'] < P['x0']] or [0])
            hl = merge([q for q in spans if abs(q['y'] - P['y']) < 5 and left_bound < q['x0'] < P['x0'] - 2])
            rowleft = max([q['x1'] for q in prices if abs(q['y'] - s['y']) < 4.5 and q['x1'] < s['x0']] or [left_bound])
            vals = [q for q in spans if abs(q['y'] - s['y']) < 4.5 and max(rowleft, left_bound) - 2 < q['x0'] < s['x0'] - 2 and q['t'] not in ('*',)]
            for v in sorted(vals, key=lambda q: q['x0']):
                vc = (v['x0'] + v['x1']) / 2
                hh = min(hl, key=lambda q: abs((q['x0'] + q['x1']) / 2 - vc)) if hl else None
                attrs.append((hh['t'] if hh else '', v['t']))
        rec = dict(ref=r, page=pn, price=pr['price'], star=pr['star'] or star_ref, aligned=bool(ph), section=section, sub=sub,
                   fam=fam, title=title, attrs=attrs, hb=hb, py=py, ry=s['y'], rx=s['x0'])
        out.setdefault(r, []).append(rec)
        page_recs.append(rec)
    for rec in page_recs:
        if not [a for a in rec['attrs'] if a[0].strip() != '€ /']:
            nb = [o for o in page_recs if [a for a in o['attrs'] if a[0].strip() != '€ /'] and abs(o['ry'] - rec['ry']) < 4.5 and rec['rx'] - 260 < o['rx'] < rec['rx']]
            if nb:
                rec['attrs'] = [a for a in max(nb, key=lambda o: o['rx'])['attrs'] if a[0].strip() != '€ /'] + [a for a in rec['attrs'] if a[0].strip() == '€ /']
for r in out:
    al = [x for x in out[r] if x['aligned']]
    out[r] = al or out[r]
json.dump(out, open('/tmp/claude-0/dg/rows.json', 'w'), ensure_ascii=False)
json.dump(codetitle, open('/tmp/claude-0/dg/codetitle.json', 'w'), ensure_ascii=False)
print(len(out), 'of', len(idx))
