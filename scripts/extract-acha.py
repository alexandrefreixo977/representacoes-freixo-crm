import json,re,sys,hashlib
from pathlib import Path
import pdfplumber
from pypdf import PdfReader
sys.stdout.reconfigure(encoding='utf-8')
if len(sys.argv)!=3:raise SystemExit('Uso: python extract-acha.py catalogo.pdf pasta-resultados')
src=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
reader=PdfReader(src)
texts=[p.extract_text() or '' for p in reader.pages]
(out/'pages.json').write_text(json.dumps(texts,ensure_ascii=False),encoding='utf-8')
records=[];warnings=[]
with pdfplumber.open(src) as pdf:
 for number,page in enumerate(pdf.pages,1):
  if number<10 or number>242:continue
  words=[w for w in page.extract_words(extra_attrs=['fontname','size']) if w['upright'] and w['x0']>=30 and w['top']<820]
  headers=[w for w in words if w['text'] in ('Código','Codigo','CÓDIGO')]
  titles=[]
  titlewords=[w for w in words if w['size']>=9 and w['x0']<560 and any(b in w['fontname'] for b in ('Bd','Bold','Heavy','Blk'))]
  for w in sorted(titlewords,key=lambda w:(round(w['top']),w['x0'])):
   line=next((l for l in titles if abs(l['top']-w['top'])<2 and -2<=w['x0']-l['x1']<25),None)
   if line:line['text']+=' '+w['text'];line['x1']=w['x1']
   else:titles.append(dict(top=w['top'],x0=w['x0'],x1=w['x1'],text=w['text']))
  family=next((f for f in ['METROLOGÍA','HERRAMIENTAS DE SEGURIDAD','CONSTRUCCIÓN','MARCAJE','HERRAMIENTAS'] if f in texts[number-1]),'Por classificar')
  independent={m[1]:m[2] for m in re.finditer(r'(?m)^([A-Z]{1,12}\d+[A-Z0-9./-]*|\d{3,}[A-Z0-9./-]*)\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?=\s|$)',texts[number-1])}
  for w in words:
   if not re.fullmatch(r'(?:[A-Z]{1,12}\d+[A-Z0-9./-]*|\d{3,}[A-Z0-9./-]*)',w['text']):continue
   prices=[p for p in words if abs(p['top']-w['top'])<2 and 0<p['x0']-w['x1']<110 and re.fullmatch(r'\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}',p['text'])]
   direct_price=bool(prices)
   if not prices and w['text'] in independent:
    prices=[dict(top=w['top'],x0=w['x1']+1,x1=w['x1']+1,text=independent[w['text']])]
   if not prices:continue
   price=min(prices,key=lambda p:p['x0'])
   hs=[h for h in headers if h['top']<w['top'] and abs(h['x0']-w['x0'])<22]
   if not hs and independent.get(w['text'])==price['text']:
    hs=[dict(top=w['top']-1,x0=w['x0'],x1=w['x1'])]
   if not hs:continue
   h=max(hs,key=lambda h:h['top'])
   # Price must sit beneath the printed Euro column, not a dimension column.
   euro=[e for e in words if e['text'] in ('E','€') and abs(e['top']-h['top'])<8 and abs((e['x0']+e['x1'])/2-(price['x0']+price['x1'])/2)<24]
   if not euro and independent.get(w['text'])!=price['text']:continue
   ts=[t for t in titles if t['top']<h['top'] and t['x1']>=h['x0']-10 and t['x0']<=h['x0']+65]
   title=max(ts,key=lambda t:t['top']) if ts else None
   if not title and any(other['x0']<h['x0']-100 and abs(other['top']-h['top'])<8 for other in headers):
    shared=[t for t in titles if t['top']<h['top'] and h['top']-t['top']<65 and re.search('[A-ZÁÉÍÓÚÑ]{3}',t['text'])]
    if shared:title=max(shared,key=lambda t:t['top'])
   if number==27 and w['text']=='57720':title=dict(top=h['top']-1,x0=h['x0'],x1=h['x1'],text='Pasta de contacto')
   if not title:warnings.append({'page':number,'reference':w['text'],'error':'Designação não identificada'});continue
   parts=[title['text']];cursor=title
   while True:
    prior=[t for t in titles if 2<cursor['top']-t['top']<16 and abs(t['x0']-cursor['x0'])<5]
    if not prior:break
    cursor=max(prior,key=lambda t:t['top']);parts.insert(0,cursor['text'])
   designation=' '.join(parts)
   sections=[t for t in titles if t['top']<cursor['top'] and t['top']<100]
   if sections and (re.match(r'^(DE |CON |PARA |TIPO |TEMPLADAS|LISAS)',designation) or len(designation)<6 or not re.search('[A-ZÁÉÍÓÚÑa-z]{3}',designation)):
    section=' '.join(t['text'] for t in sorted(sections,key=lambda t:(t['top'],t['x0'])) if re.search('[A-ZÁÉÍÓÚÑ]{3}',t['text']))
    if section:designation=section+' — '+designation
   rowwords=sorted([p for p in words if abs(p['top']-w['top'])<2 and p['x0']>=price['x1'] and p['x0']< (290 if h['x0']<100 else 570)],key=lambda p:p['x0'])
   details=' '.join(p['text'] for p in rowwords)
   records.append({'reference':w['text'],'designation':designation,'family':family,'price':price['text'].replace('.','').replace(',','.'),'currency':'EUR','source_page':number,'source_row':w['text']+' '+price['text']+' '+details,'technical_description':details if direct_price else '', 'coordinate_price':direct_price,'group_key':str(number)+':'+str(round(h['top'],1)),'x':w['x0'],'y':w['top']})
  if number%40==0:print('pages',number,'records',len(records),flush=True)
seen={};duplicates=[]
for r in records:
 if r['reference'] in seen:duplicates.append({'reference':r['reference'],'pages':[seen[r['reference']]['source_page'],r['source_page']],'prices':[seen[r['reference']]['price'],r['price']]})
 else:seen[r['reference']]=r
report={'source':src.name,'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'pages':len(texts),'rows':len(records),'unique_references':len(seen),'duplicate_occurrences':duplicates,'errors':warnings}
(out/'candidates.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items()if k not in ('duplicate_occurrences','errors')},ensure_ascii=False));print('duplicates',len(duplicates),'errors',len(warnings))
