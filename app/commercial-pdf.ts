import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export type CommercialSnapshot = {
 document: {order_number:string; document_type:string; order_date:string; currency:string; subtotal:number; total:number; shipping:number; shipping_known:boolean; vat_treatment:string; notes?:string; payment_terms?:string; delivery_terms?:string; valid_until?:string; revision_number?:number};
 company: {brand_name:string;legal_name?:string;address?:string;tax_number?:string;phone?:string;email:string;website:string};
 client: {trade_name:string;email?:string;address?:string;city?:string;postal_code?:string;tax_number?:string;phone?:string};
 contact?:{first_name?:string;last_name?:string;email?:string;phone?:string}|null;
 manufacturer:{name:string}; seller:{full_name:string};
 lines:Array<{reference_snapshot:string;designation_snapshot:string;variant_snapshot?:string;quantity:number;list_price_snapshot:number;applied_discounts:number[];net_unit_price:number;line_total:number;notes?:string;cancelled_at?:string}>;
};

export async function commercialPdf(s:CommercialSnapshot,logoBytes:Uint8Array,fontBytes?:Uint8Array){
 const pdf=await PDFDocument.create();pdf.setTitle(`${s.document.order_number} — ${s.client.trade_name}`);pdf.setAuthor(s.company.brand_name);pdf.setCreationDate(new Date(`${s.document.order_date.slice(0,10)}T12:00:00Z`));pdf.setModificationDate(new Date(`${s.document.order_date.slice(0,10)}T12:00:00Z`));
 pdf.registerFontkit(fontkit);
 const font=fontBytes?await pdf.embedFont(fontBytes,{subset:true}):await pdf.embedFont(StandardFonts.Helvetica);
 const bold=fontBytes?font:await pdf.embedFont(StandardFonts.HelveticaBold);
 const logo=await pdf.embedPng(logoBytes),ink=rgb(.16,.16,.15),gold=rgb(.62,.49,.25),muted=rgb(.40,.40,.37);
 let page!:PDFPage,y=0;
 const text=(value:unknown,x:number,top:number,size=9,strong=false,color=ink)=>page.drawText(String(value??''),{x,y:top,size,font:strong?bold:font,color});
 const wrap=(value:unknown,width:number,size=9)=>{const output:string[]=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize((line?line+' ':'')+word,size)>width){if(line)output.push(line);line='';let part='';for(const char of word){if(font.widthOfTextAtSize(part+char,size)>width){output.push(part);part='';}part+=char;}line=part;}else line+=(line?' ':'')+word;}output.push(line);}return output;};
 const money=(n:number)=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:s.document.currency}).format(Number(n));
 const date=(d?:string)=>d?d.slice(0,10).split('-').reverse().join('/'):'—';
 const fresh=()=>{page=pdf.addPage([595.28,841.89]);y=798;const dim=logo.scaleToFit(125,48);page.drawImage(logo,{x:36,y:y-dim.height,width:dim.width,height:dim.height});text(s.company.brand_name.toUpperCase(),190,y-8,12,true);text(s.document.document_type==='proposal'?'ORÇAMENTO / PROPOSTA COMERCIAL':'NOTA DE ENCOMENDA',190,y-29,11,true,gold);text(`${s.document.order_number}   ·   ${date(s.document.order_date)}`,190,y-46,10);page.drawLine({start:{x:36,y:734},end:{x:559,y:734},color:gold,thickness:1});y=713;};
 const ensure=(height:number)=>{if(y-height<62)fresh();};
 const paragraph=(label:string,value:unknown)=>{if(!value)return;const lines=wrap(`${label}${value}`,520);for(const line of lines){ensure(15);text(line,36,y);y-=13;}y-=4;};
 const tableHead=()=>{page.drawRectangle({x:36,y:y-21,width:523,height:25,color:rgb(.95,.94,.90)});['Referência','Designação / Variante','Qtd.','PVP','Desc.','Líquido','Total'].forEach((label,i)=>text(label,[40,114,312,348,398,455,514][i],y-12,8,true));y-=30;};
 fresh();
 const left=[s.company.legal_name||s.company.brand_name,s.company.address,s.company.tax_number&&`NIF: ${s.company.tax_number}`,s.company.phone,s.company.email,s.company.website].filter(Boolean).flatMap(v=>wrap(v,247));
 const right=[s.client.trade_name,s.client.tax_number&&`NIF: ${s.client.tax_number}`,s.client.address,[s.client.postal_code,s.client.city].filter(Boolean).join(' '),[s.contact?.first_name,s.contact?.last_name].filter(Boolean).join(' '),s.contact?.email||s.client.email,s.contact?.phone||s.client.phone].filter(Boolean).flatMap(v=>wrap(v,247));
 text('REPRESENTANTE',36,y,8,true,gold);text('CLIENTE',307,y,8,true,gold);y-=17;
 const start=y;left.forEach((line,i)=>text(line,36,start-i*13));right.forEach((line,i)=>text(line,307,start-i*13));y-=Math.max(left.length,right.length)*13+17;
 paragraph('Fabricante: ',s.manufacturer.name);paragraph('Comercial responsável: ',s.seller.full_name);
 if(s.document.document_type==='proposal')paragraph('Validade: ',date(s.document.valid_until));
 if((s.document.revision_number||1)>1)paragraph('Revisão: ',s.document.revision_number);
 ensure(70);tableHead();
 for(const line of s.lines){
  const description=wrap([line.designation_snapshot,line.variant_snapshot,line.notes,line.cancelled_at?'ARTIGO ANULADO':null].filter(Boolean).join('\n'),190,8);
  const refs=wrap(line.reference_snapshot,69,8),discounts=wrap(line.applied_discounts.map(d=>`${d}%`).join(' + ')||'—',51,8);
  const height=Math.max(description.length,refs.length,discounts.length)*11+15;
  if(height>600)throw new Error('Descrição de artigo demasiado longa para uma página. Reduza as observações da linha.');
  if(y-height<62){fresh();tableHead();}
  refs.forEach((v,i)=>text(v,40,y-i*11,8,true));description.forEach((v,i)=>text(v,114,y-i*11,8));
  text(Number(line.quantity).toLocaleString('pt-PT'),312,y,8,true);
  const numeric=(value:number,right:number)=>{const v=money(value);text(v,right-font.widthOfTextAtSize(v,8),y,8);};
  numeric(line.list_price_snapshot,392);discounts.forEach((v,i)=>text(v,398,y-i*11,8));numeric(line.net_unit_price,505);numeric(line.line_total,554);
  y-=height;page.drawLine({start:{x:36,y:y+6},end:{x:559,y:y+6},color:rgb(.88,.88,.85),thickness:.4});
 }
 y-=9;ensure(140);
 const listTotal=s.lines.reduce((sum,l)=>sum+Number(l.list_price_snapshot)*Number(l.quantity),0);
 for(const [label,value] of [['Subtotal PVP',money(listTotal)],['Descontos',money(listTotal-Number(s.document.subtotal))],['Subtotal líquido',money(s.document.subtotal)],['Portes',s.document.shipping_known?money(s.document.shipping):'A confirmar'],[s.document.shipping_known?'Total':'Total parcial · portes a confirmar',money(s.document.total)]]){text(label,290,y,9);text(value,554-font.widthOfTextAtSize(value,10),y,10,true);y-=18;}
 paragraph('',({included:'IVA incluído',excluded:'IVA não incluído',exempt:'Isento de IVA',undetermined:'Tratamento fiscal por determinar'} as Record<string,string>)[s.document.vat_treatment]||'Tratamento fiscal por determinar');
 paragraph('Pagamento: ',s.document.payment_terms);paragraph('Prazo de entrega: ',s.document.delivery_terms);paragraph('Observações: ',s.document.notes);
 const pages=pdf.getPages();pages.forEach((p,index)=>{page=p;page.drawLine({start:{x:36,y:47},end:{x:559,y:47},color:gold,thickness:.5});text(s.company.brand_name,36,34,8,true);text(`${s.company.email} · ${s.company.website}`,36,22,7,false,muted);text(`Página ${index+1} de ${pages.length}`,489,28,8,false,muted);});
 return pdf.save();
}
