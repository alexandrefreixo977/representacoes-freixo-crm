import json,re,collections,sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
root=Path(sys.argv[1]);rows=json.loads((root/'candidates.json').read_text(encoding='utf-8'));pages=json.loads((root/'pages.json').read_text(encoding='utf-8'))
known={};conflicts=[]
for r in rows:
 if r['reference'] in known and known[r['reference']]['price']!=r['price']:conflicts.append(r['reference'])
 else:
  if r['reference'] not in known or r.get('coordinate_price') and not known[r['reference']].get('coordinate_price'):known[r['reference']]=r
text_rows={}
for n,text in enumerate(pages,1):
 if not 10<=n<=242:continue
 for m in re.finditer(r'(?m)^([A-Z]{1,12}\d+[A-Z0-9./-]*|\d{3,}[A-Z0-9./-]*)\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?=\s|$)',text):
  text_rows.setdefault(m[1],[]).append({'page':n,'price':m[2].replace('.','').replace(',','.')})
missing={r:v for r,v in text_rows.items() if r not in known};mismatch={r:v for r,v in text_rows.items() if r in known and known[r]['price'] not in [x['price'] for x in v]}
ambiguous=[r for r in known.values() if len(r['designation'])<6 or not re.search('[A-Za-zÁÉÍÓÚÑ]{3}',r['designation'])]
report={'coordinate_references':len(known),'independent_text_references':len(text_rows),'missing_from_coordinates':missing,'price_mismatches':mismatch,'conflicting_duplicates':conflicts,'ambiguous_titles':ambiguous,'families':dict(collections.Counter(r['family'] for r in known.values()))}
(root/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'validated-unique.json').write_text(json.dumps(list(known.values()),ensure_ascii=False),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ('missing_from_coordinates','ambiguous_titles')},ensure_ascii=False));print('missing',len(missing),'ambiguous titles',len(ambiguous));print('missing samples',list(missing.items())[:20]);print('title samples',ambiguous[:5])

source=json.loads((root/'analysis.json').read_text(encoding='utf-8'))
(root/'catalog-import.json').write_text(json.dumps({'source':{'sha256':source['sha256'],'filename':source['source']},'rows':list(known.values())},ensure_ascii=False),encoding='utf-8')
