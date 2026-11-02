import json,hashlib,sys
from pathlib import Path
import pdfplumber,pypdfium2 as pdfium
if len(sys.argv)!=4:raise SystemExit('Uso: python extract-acha-images.py catalogo.pdf referencias-validadas.json pasta-saida')
src=Path(sys.argv[1]);out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
rows=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
doc=pdfium.PdfDocument(src); manifest=[];assets={}
with pdfplumber.open(src) as pdf:
 for number in sorted({r['source_page'] for r in rows}):
  page=pdf.pages[number-1]; selected=[r for r in rows if r['source_page']==number]
  vertical=[e for e in page.edges if e.get('orientation')=='v' and 275<e['x0']<315 and e['height']>150]
  for row in selected:
   # Crop only at printed section boundaries. A complete official section retains
   # the reference, photo/diagram and context; never infer a photo from proximity.
   split=any(e['top']<=row['y']<=e['bottom'] for e in vertical)
   left,right=(30,299) if split and row['x']<299 else (299,566) if split else (30,566)
   horizontal=[e['top'] for e in page.edges if e.get('orientation')=='h' and e['x0']<=left+9 and e['x1']>=right-9 and 65<e['top']<810]
   top=max([70]+[y for y in horizontal if y<row['y']-3]);bottom=min([809]+[y for y in horizontal if y>row['y']+8])
   if bottom-top<55:top,bottom=70,809
   box=tuple(round(v,1) for v in (left,top,right,bottom));key=f'p{number:03d}-'+hashlib.sha256(str(box).encode()).hexdigest()[:10]
   manifest.append({'reference':row['reference'],'page':number,'key':key,'box':box,'kind':'official_catalogue_section'})
   assets.setdefault(key,{'page':number,'box':box})
  if number%40==0:print('mapped page',number,flush=True)
 for index,(key,item) in enumerate(assets.items()):
  n=item['page'];left,top,right,bottom=item['box'];scale=2.2
  image=doc[n-1].render(scale=scale).to_pil();image=image.crop(tuple(round(v*scale) for v in (left,top,right,bottom))).convert('RGB')
  image.save(out/(key+'.webp'),'WEBP',quality=88,method=4)
  if index%100==0:print('rendered',index,'of',len(assets),flush=True)
(out/'manifest.json').write_text(json.dumps({'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'references':manifest,'assets':assets},ensure_ascii=False),encoding='utf-8')
print('references',len(manifest),'assets',len(assets),flush=True)
