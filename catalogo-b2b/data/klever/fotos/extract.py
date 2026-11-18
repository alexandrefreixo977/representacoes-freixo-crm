import fitz, sys, io, json
from PIL import Image, ImageChops, ImageDraw
doc = fitz.open(sys.argv[1])
refs = [r.strip() for r in open(sys.argv[2]) if r.strip()]
out = sys.argv[3]
def is_refcol(page, hit):
    cy = (hit.y0+hit.y1)/2
    for w in page.get_text("words"):
        r = fitz.Rect(w[:4])
        if r.y0 <= cy <= r.y1 and hit.x0 - 170 < r.x1 <= hit.x0 - 1:
            return False
    return True
chosen = {}
ALIAS = {"KCJ-XC-30-Y": "KCJ-XC-30", "S10-CER": "S10-"}
for ref in refs:
    toks = ALIAS.get(ref, ref).split()
    for pn, page in enumerate(doc):
        if ref in chosen: break
        ws = page.get_text("words")
        for i in range(len(ws) - len(toks) + 1):
            if [w[4] for w in ws[i:i+len(toks)]] != toks: continue
            hit = fitz.Rect(ws[i][:4]) | fitz.Rect(ws[i+len(toks)-1][:4])
            if is_refcol(page, hit):
                chosen[ref] = (pn, hit); break
missing = [r for r in refs if r not in chosen]
print("sem linha:", missing)
res = {}
for ref, (pn, hit) in chosen.items():
    page = doc[pn]
    cy = (hit.y0+hit.y1)/2
    same = sorted((h.y0+h.y1)/2 for r2,(p2,h) in chosen.items() if p2==pn and abs(h.x0-hit.x0)<60)
    i = same.index(cy)
    top = max(cy-45, (same[i-1]+cy)/2 if i>0 else cy-45)
    bot = min(cy+45, (same[i+1]+cy)/2 if i+1<len(same) else cy+45)
    clip = fitz.Rect(max(0, hit.x0-240), top+2, hit.x0-3, bot-2)
    # texto à esquerda na faixa: começa depois dele
    for w in page.get_text("words"):
        r = fitz.Rect(w[:4])
        if r.intersects(clip) and r.x1 < hit.x0 - 3: clip.x0 = max(clip.x0, r.x1 + 2)
    pix = page.get_pixmap(clip=clip, dpi=300)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    bg = Image.new("RGB", img.size, (255,255,255))
    diff = ImageChops.difference(img, bg).convert("L").point(lambda v: 255 if v > 40 else 0)
    bbox = diff.getbbox()
    if bbox: img = img.crop(bbox)
    name = f"{out}/{ref.replace(' ','_').replace('/','_')}.png"
    img.save(name); res[ref] = (pn, [round(v) for v in clip], img.size)
json.dump(res, open(f"{out}/res.json","w"))
# folha de contacto
W=260; H=150; cols=6; rows=(len(res)+cols-1)//cols
sheet = Image.new("RGB",(cols*W, rows*(H+20)),"white"); d=ImageDraw.Draw(sheet)
for k,ref in enumerate(res):
    im = Image.open(f"{out}/{ref.replace(' ','_').replace('/','_')}.png"); im.thumbnail((W-10,H-5))
    x=(k%cols)*W; y=(k//cols)*(H+20); sheet.paste(im,(x+5,y)); d.text((x+5,y+H+3),ref,fill="black")
sheet.save(f"{out}/sheet.png")
