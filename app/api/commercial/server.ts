import { createClient } from '@supabase/supabase-js';
import { mailSession, MailError } from '../mail/server';
import type { CommercialSnapshot } from '../../commercial-pdf';

export async function commercialSession(request:Request){
 const session=await mailSession(request);
 const allowed=await session.db.rpc('has_catalog_orders_beta_access');
 if(allowed.error||allowed.data!==true)throw new MailError(403,'Catálogo não autorizado.');
 const profile=await session.db.from('profiles').select('role,full_name').eq('id',session.user.id).single();
 if(profile.error)throw new MailError(403,'Perfil indisponível.');
 return {...session,profile:profile.data};
}
export function commercialService(){
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new MailError(503,'A validação comercial ainda não está configurada no servidor.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function documentSnapshot(db:Awaited<ReturnType<typeof commercialSession>>['db'],id:string){
 const result=await db.from('catalog_orders').select('*').eq('id',id).single();
 if(result.error)throw new MailError(404,'Documento indisponível.');
 const d=result.data;
 const [company,client,contact,manufacturer,seller,lines]=await Promise.all([
  db.from('commercial_company').select('*').single(),db.from('clients').select('*').eq('id',d.client_id).single(),
  d.contact_id?db.from('client_contacts').select('*').eq('id',d.contact_id).single():Promise.resolve({data:null,error:null}),
  db.from('manufacturers').select('name').eq('id',d.manufacturer_id).single(),db.from('profiles').select('full_name').eq('id',d.seller_id).single(),
  db.from('catalog_order_lines').select('*').eq('order_id',id).order('created_at').order('id'),
 ]);
 for(const r of [company,client,contact,manufacturer,seller,lines])if(r.error)throw new MailError(400,'Não foi possível carregar os dados completos do documento.');
 const snapshot={document:d,company:company.data,client:{...client.data,tax_number:client.data.tax_id},contact:contact.data,manufacturer:manufacturer.data,seller:seller.data,lines:lines.data} as CommercialSnapshot;
 return {document:d,snapshot};
}
export const bytesToBase64=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
export const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export const commercialFilename=(s:CommercialSnapshot)=>`${s.document.document_type==='proposal'?'Orcamento':'Encomenda'}_${s.document.order_number}_${s.client.trade_name.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,70)}.pdf`;
