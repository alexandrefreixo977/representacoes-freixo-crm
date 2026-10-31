export type ImportRow={reference:string;designation:string;family:string;subfamily?:string;price:string;currency:string;ean?:string;technical_description?:string;source_page?:number;source_row?:string};
export function parseCsv(text:string):string[][]{
 const delimiter=(text.split(/\r?\n/)[0].match(/;/g)||[]).length>(text.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';
 const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(Boolean))rows.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw new Error('CSV com aspas por fechar.');row.push(value);if(row.some(Boolean))rows.push(row);return rows;
}
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function normalizeImport(rows:string[][]):ImportRow[]{
 const headers=(rows[0]||[]).map(normalize),index=(...keys:string[])=>headers.findIndex(h=>keys.includes(h));
 const ref=index('reference','referencia','codigo'),name=index('designation','designacao','descripcion','designacion'),price=index('price','preco','pvp','precio'),family=index('family','familia'),ean=index('ean'),sub=index('subfamily','subfamilia');
 if([ref,name,price].some(i=>i<0))throw new Error('São necessárias colunas Referência, Designação e PVP.');
 return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>({reference:r[ref]?.trim()||'',designation:r[name]?.trim()||'',price:(r[price]||'').trim().replace(/\s|€/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'),family:r[family]?.trim()||'',subfamily:r[sub]?.trim()||'',ean:r[ean]?.trim()||'',currency:'EUR'}));
}
export function validateImport(rows:ImportRow[]){
 const errors:string[]=[],seen=new Set<string>();rows.forEach((r,i)=>{if(!r.reference||!r.designation||!/^\d+(\.\d{1,4})?$/.test(r.price)||Number(r.price)<=0)errors.push(`Linha ${i+2}: referência, designação ou preço inválidos.`);if(seen.has(r.reference))errors.push(`Referência repetida: ${r.reference}`);seen.add(r.reference);});
 return {errors,warnings:[`${rows.filter(r=>!r.ean).length} referências sem EAN.`,`${rows.filter(r=>!r.family||r.family==='Por classificar').length} referências sem família confirmada.`]};
}
