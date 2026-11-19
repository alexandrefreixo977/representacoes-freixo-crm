import json, re, collections
R = json.load(open('/tmp/claude-0/dg/rows.json'))
UNITS = {'mm', 'kg', 'g', 'g.', 'gr', 'gr.', 'cm', 'm', 'v', 'w', 'nm', 'n*m', 'bar', '"', '“', '”', 'kn'}
def clean(s):
    s = s.replace('', '-').replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', s).strip()
def attr(h, v):
    h, v = clean(h), clean(v)
    if not h or h in ('-', ':', '•', '€ /') or h.startswith('·') or re.match(r'^[\d.,/ x"]+$', h) or len(h) > 22:
        return '' if h == '€ /' else v
    toks = h.split()
    if toks[-1].lower() in UNITS and not re.search(r'[a-zA-Z"]$', v.replace('x', '')) :
        unit = toks[-1].rstrip('.')
        name = ' '.join(toks[:-1])
        return f'{name} {v} {unit}'.strip()
    if h.lower() in UNITS:
        return v
    return f'{h} {v}'
fams = collections.Counter()
def build(r):
    x = R[r][0]
    title = clean(x['title']) or clean(x['sub'])
    parts = []
    for h, v in x['attrs']:
        a = attr(h, v)
        if a and a not in parts:
            parts.append(a)
    sec, sub = clean(x['section']), clean(x['sub'])
    fam = sub or sec or 'Outros'
    if len(title.split()) <= 2 and fam not in title and fam != 'Outros':
        title = f'{fam} · {title}'
    if 'Cu-Be' in sec:
        mat = 'Cu-Be (cobre-berílio)' if r.startswith('10') else 'Al-Br (alumínio-bronze)' if r.startswith('15') else ''
        if mat:
            title += f' · {mat}'
    des = title + (' · ' + ' · '.join(parts) if parts else '')
    return des, fam
if __name__ == '__main__':
    import random; random.seed(5)
    for r in random.sample(list(R), 40):
        d, f = build(r); print(r, '|', R[r][0]['price'], '|', d, '|', f)
    for r in R: fams[build(r)[1]] += 1
    print(len(fams)); print(fams.most_common()[-30:])
    print(max((len(build(r)[0]), r) for r in R))
