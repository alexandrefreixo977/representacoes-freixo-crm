import fitz, sys, io, json
sys.path.insert(0, "/home/user/representacoes-freixo-crm/catalogo-b2b/data")
from extract_bluemaster_images import render
from PIL import Image, ImageDraw
doc = fitz.open("t.pdf")
exec(open("extract.py").read().split("missing =")[0].split("chosen = {}",1)[0].split("out = sys.argv[3]")[1])  # is_refcol
refs=[r.strip() for r in open("refs.txt") if r.strip()]
exec("chosen = {}" + open("extract.py").read().split("chosen = {}",1)[1].split("missing =")[0])
res={}
for ref,(pn,hit) in chosen.items():
    page=doc[pn]; cy=(hit.y0+hit.y1)/2; best=None
    for i in page.get_image_info(xrefs=True):
        r=fitz.Rect(i["bbox"])&page.rect
        if r.is_empty or not i["xref"]: continue
        gap=hit.x0-r.x1
        if gap<-8 or gap>200: continue
        if not (r.y0-15<=cy<=r.y1+15): continue
        if r.height>260 or r.width>330: continue
        s=abs((r.y0+r.y1)/2-cy)+gap*0.3
        if best is None or s<best[0]: best=(s,i["xref"],r)
    if best: res[ref]=(best[1],[round(v) for v in best[2]],pn)
json.dump(res,open("xref.json","w"))
W=260;H=150;cols=6;rows=(len(refs)+cols-1)//cols
sheet=Image.new("RGB",(cols*W,rows*(H+20)),"white");d=ImageDraw.Draw(sheet)
for k,ref in enumerate(refs):
    x=(k%cols)*W;y=(k//cols)*(H+20)
    if ref in res:
        im=Image.open(io.BytesIO(doc[res[ref][2]].get_pixmap(clip=fitz.Rect(res[ref][1]),dpi=200).tobytes('png')));im.thumbnail((W-10,H-5));sheet.paste(im,(x+5,y))
    d.text((x+5,y+H+3),f"{ref} {res.get(ref,['-'])[0]}",fill="red" if ref not in res else "black")
sheet.save("xsheet.png")
print([r for r in refs if r not in res])
