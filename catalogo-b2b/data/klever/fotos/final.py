import fitz, io, json, hashlib, pathlib, sys
from PIL import Image, ImageChops, ImageDraw
sys.path.insert(0, "/home/user/representacoes-freixo-crm/catalogo-b2b/data")
from normalize_images import normalize
doc = fitz.open("t.pdf")
X = json.load(open("xref.json"))
P = lambda *a: [v*1.8 for v in a]
HAND = {  # página (0-based), recorte em px da página a 40 dpi
 "KCJ-1-Y": (2, P(28,163,110,187)), "KCJ-1MD": (2, P(28,193,110,222)),
 "PLS-200XC-30G": (2, P(120,535,212,565)), "KCJ-XH-35": (2, P(590,488,645,527)),
 "KCJ-XH-35X": (2, P(535,353,580,372)),
 "ECO-200XC-20EX": (3, P(493,206,592,226)), "ECO-200XC-30EX": (3, P(493,235,592,255)), "ECO-200XC-35EX": (3, P(493,267,592,287)),
 "S24": (4, P(25,390,125,420)), "ES44": (4, P(30,512,135,545)),
 "US53R": (4, P(495,295,600,322)), "US53B": (4, P(495,385,600,410)),
 "US35": (4, P(495,458,605,488)), "C-105": (4, P(510,498,580,545)),
 "B1-CER": (5, P(490,355,550,378)), "SRTD6GPO": (6, P(40,315,100,380)),
 "753225": (7, P(490,301,600,334)),
 "C109-MD": (9, P(35,195,140,222)), "C103-MD": (9, P(35,232,140,262)),
 "X7070 MDP": (9, P(25,372,130,402)), "X6040 MDP": (9, P(25,500,125,525)),
 "X6060 MDP": (9, P(25,563,125,585)), "H10008-B3": (9, P(505,240,565,262)),
 "H10010": (9, P(510,350,555,372)),
}
refs = [r.strip() for r in open("refs.txt") if r.strip()]
out = pathlib.Path("/home/user/representacoes-freixo-crm/catalogo-b2b/public/img/klever"); out.mkdir(parents=True, exist_ok=True)
for f in out.glob("*"): f.unlink()
pairs = []
for ref in refs:
    if ref in HAND: pn, r = HAND[ref]
    elif ref in X: pn, r = X[ref][2], X[ref][1]
    else: continue
    img = Image.open(io.BytesIO(doc[pn].get_pixmap(clip=fitz.Rect(r), dpi=300).tobytes("png"))).convert("RGB")
    diff = ImageChops.difference(img, Image.new("RGB", img.size, "white")).convert("L").point(lambda v: 255 if v > 40 else 0)
    if diff.getbbox(): img = img.crop(diff.getbbox())
    name = f"klever-{hashlib.md5(img.tobytes()).hexdigest()[:10]}.jpg"
    if not (out/name).exists():
        img.save(out/name, quality=92); normalize(out/name)
    pairs.append((ref, name))
json.dump(pairs, open("pairs.json","w"))
W=260;H=150;cols=6;rows=(len(refs)+cols-1)//cols
sheet=Image.new("RGB",(cols*W,rows*(H+22)),"white");d=ImageDraw.Draw(sheet)
pm=dict(pairs)
for k,ref in enumerate(refs):
    x=(k%cols)*W;y=(k//cols)*(H+22)
    d.text((x+5,y+2),ref,fill="red")
    if ref in pm:
        im=Image.open(out/pm[ref]);im.thumbnail((W-10,H-10));sheet.paste(im,(x+5,y+16))
    d.rectangle([x,y,x+W-1,y+H+21],outline="grey")
sheet.save("fsheet.png"); print(len(pairs), len(set(pm.values())))
