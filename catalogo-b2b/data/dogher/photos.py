import json, sys, io, collections, hashlib
import pymupdf
from PIL import Image
R = json.load(open('/tmp/claude-0/dg/rows.json'))
d = pymupdf.open('/mnt/project-files/DOGHER_2025-26_Catalogo-PT.pdf')
pages = sys.argv[1].split(',') if len(sys.argv) > 1 and sys.argv[1] != 'all' else None
heads_by_page = collections.defaultdict(set)
for r, L in R.items():
    x = L[0]
    if x['hb']: heads_by_page[x['page']].add(tuple(x['hb']))
def render(page, rect, zoom=2.5):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect, alpha=False)
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')
def score(img):
    px = list(img.resize((64, 64)).getdata())
    n = len(px)
    white = sum(1 for p in px if min(p) > 235) / n
    mid = sum(1 for p in px if 40 < sum(p) / 3 < 215) / n
    color = sum(1 for p in px if max(p) - min(p) > 40) / n
    return white, mid, color
def is_photo(img):
    w, h = img.size
    if max(w, h) / max(1, min(w, h)) > 5: return False
    white, mid, color = score(img)
    return (mid > 0.12 or color > 0.05) and white < 0.97
imgcache = {}
def images(pn):
    if pn not in imgcache:
        p = d[pn]; W = p.rect.width
        res = []
        for im in p.get_image_info(xrefs=True):
            rc = pymupdf.Rect(im['bbox']) & p.rect
            if rc.is_empty or rc.width > 0.8 * W or rc.width * rc.height < 1500 or min(rc.width, rc.height) < 25: continue
            rc.xref = im['xref']
            res.append(rc)
        imgcache[pn] = res
    return imgcache[pn]
blocks = {}
for r, L in R.items():
    x = L[0]; pn = x['page']
    if pages and str(pn) not in pages: continue
    p = d[pn]; W, H = p.rect.width, p.rect.height
    if x['hb']:
        hx, hy = x['hb']
        right = [h[0] for h in heads_by_page[pn] if abs(h[1] - hy) < 40 and h[0] > hx + 50]
        x1 = min(right) - 5 if right else W
        left = [h[0] for h in heads_by_page[pn] if abs(h[1] - hy) < 40 and h[0] < hx - 50]
        x0 = hx - 25
        y0 = hy - 15
        y1 = x['py'] - 4 if x['py'] and x['py'] > hy + 40 else hy + 260
        key = (pn, round(hx), round(hy))
    else:
        x0, x1, y0, y1 = 0, W, 90, x['ry'] - 10
        key = (pn, None, None)
    if key not in blocks:
        cands = []
        for rc in images(pn):
            c = (rc.x0 + rc.x1) / 2, (rc.y0 + rc.y1) / 2
            if x0 <= c[0] <= x1 and y0 <= c[1] <= y1:
                cands.append(rc)
        best = None
        for rc in sorted(cands, key=lambda rc: -rc.width * rc.height):
            img = render(p, rc, 0.6)
            if is_photo(img):
                best = rc; break
        blocks[key] = best
    x['photo_key'] = list(key) if blocks[key] else None
    x['photo_rect'] = list(blocks[key]) if blocks[key] else None
    x['photo_xref'] = getattr(blocks[key], 'xref', 0) if blocks[key] else 0
photo_ok = {}
fb = 0
for r, L in R.items():
    x = L[0]; pn = x['page']
    if x.get('photo_rect') or (pages and str(pn) not in pages): continue
    p = d[pn]; best = None
    cands = [rc for rc in images(pn) if rc.y1 < x['ry'] + 5 and x['ry'] - rc.y1 < 200 and abs((rc.x0 + rc.x1) / 2 - x['rx']) < 170]
    for rc in sorted(cands, key=lambda rc: (x['ry'] - rc.y1) + abs((rc.x0 + rc.x1) / 2 - x['rx']) * 0.5):
        k = (pn, tuple(round(v) for v in rc))
        if k not in photo_ok:
            photo_ok[k] = is_photo(render(p, rc, 0.6))
        if photo_ok[k]:
            best = rc; break
    if best:
        fb += 1
        x['photo_key'] = [pn, 'fb', round(best.x0), round(best.y0)]
        x['photo_rect'] = list(best); x['photo_fallback'] = True
print('fallback', fb)
json.dump(R, open('/tmp/claude-0/dg/rows_ph.json', 'w'), ensure_ascii=False)
print('blocks', len(blocks), 'com foto', sum(1 for b in blocks.values() if b), 'refs com foto', sum(1 for r in R if R[r][0].get('photo_rect')))
