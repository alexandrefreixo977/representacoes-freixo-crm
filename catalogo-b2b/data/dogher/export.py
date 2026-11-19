"""Gera data/dogher/tabela_2025_26.tsv, data/dogher/promo2026.tsv e as fotos em public/img/dogher."""
import json, io, hashlib, pathlib, re, sys
import pymupdf
from PIL import Image
sys.path.insert(0, '/home/user/representacoes-freixo-crm/catalogo-b2b/data')
sys.path.insert(0, '/tmp/claude-0/dg/scripts')
from normalize_images import normalize
from fmt import build, clean
REPO = pathlib.Path('/home/user/representacoes-freixo-crm/catalogo-b2b')
R = json.load(open('/tmp/claude-0/dg/rows_ph.json'))
P = json.load(open('/tmp/claude-0/dg/promo.json'))
d = pymupdf.open('/mnt/project-files/DOGHER_2025-26_Catalogo-PT.pdf')
out = REPO / 'public/img/dogher'; out.mkdir(parents=True, exist_ok=True)
for f in out.glob('*'): f.unlink()
saved = {}
def raw_image(xref):
    # imagem original do PDF (sem o texto da página por cima); o fundo transparente passa a branco
    if not xref:
        return None
    try:
        pix = pymupdf.Pixmap(d, xref)
        if pix.n - pix.alpha >= 4:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        smask = d.xref_get_key(xref, 'SMask')
        im = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')
        if smask[0] == 'xref':
            m = pymupdf.Pixmap(d, int(smask[1].split()[0]))
            mask = Image.open(io.BytesIO(m.tobytes('png'))).convert('L').resize(im.size)
            im.putalpha(mask)
        bg = Image.new('RGB', im.size, 'white'); bg.paste(im, mask=im.split()[3])
        if min(bg.size) < 60:
            return None
        return bg
    except Exception:
        return None
rows = []
for r, L in R.items():
    x = L[0]
    des, fam = build(r)
    unit, pack = 'un', 1
    attrs = [(h, v) for h, v in x['attrs']]
    m = [v for h, v in attrs if h.strip() == '€ /' and re.match(r'^\d+$', v.strip())]
    mb = re.match(r'^\d{3}[A-Z]?-.+-(\d{1,3})$', r)
    if not m and mb and 'Bits' in (x['section'] + x['sub']) and any(v.strip() == mb.group(1) for h, v in attrs):
        m = [mb.group(1)]
    if 'Bits' in (x['section'] + x['sub']):
        des = re.sub(r' · \d{1,3}(?= · |$)', '', des)
    if m and int(m[0]) > 1:
        des = des.replace(' · ' + m[0] + ' ', ' ').rstrip()
        if des.endswith(' · ' + m[0]):
            des = des[: -len(' · ' + m[0])]
        unit, pack = 'cx', int(m[0])
        des += f' (caixa de {pack} un)'
    sec = clean(x['section'])
    desc = f"{sec} · {fam}. Catálogo DOGHER TOOLS 2025-26, pág. {x['page']}."
    if x['star']:
        desc += ' Até ao fim das existências.'
    img = ''
    if x.get('photo_rect') and not x.get('photo_fallback'):
        key = tuple(x['photo_key'])
        if key not in saved:
            im = raw_image(x.get('photo_xref', 0))
            if im is None:
                pix = d[x['page']].get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=pymupdf.Rect(x['photo_rect']), alpha=False)
                im = Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
            name = f"dogher-{hashlib.md5(repr(key).encode()).hexdigest()[:10]}.jpg"
            im.save(out / name, quality=90); normalize(out / name)
            saved[key] = name
        img = '/img/dogher/' + saved[key]
    price = x['price'].replace('.', '').replace(',', '.')
    rows.append((r, fam, des, desc, unit, str(pack), price, img))
with open(REPO / 'data/dogher/tabela_2025_26.tsv', 'w', encoding='utf-8') as fh:
    fh.write('# Catálogo Geral DOGHER TOOLS 2025-26 (PT): referência, família, designação, descrição, unidade, embalagem, preço de tabela (€), foto\n')
    for row in rows:
        fh.write('\t'.join(c.replace('\t', ' ') for c in row) + '\n')
print(len(rows), 'artigos', len(saved), 'fotos', sum(1 for r in rows if r[7]), 'com foto')
