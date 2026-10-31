import { mailError,json,MailError } from '../../mail/server';
import { requireMailPermission } from '../../mail/server';
import { commercialSession,commercialService } from '../server';
import { userSignature } from '../../mail/signature';
import { signedMailBody } from '../../../mail-signature-body';
import { validateRecipients } from '../../../mail-recipients';
import { sendApprovedCommercialMail } from '../../send-email/route';
import type { CommercialSnapshot } from '../../../commercial-pdf';

export async function POST(request:Request){try{
 const {db,user}=await commercialSession(request);
 await requireMailPermission(db);
 const body=await request.json() as {id:string;confirm:boolean;to:string[];cc?:string[];bcc?:string[];subject?:string;text?:string};
 if(body.confirm!==true)throw new MailError(400,'Confirme o envio do PDF aprovado.');
 const found=await db.from('catalog_orders').select('*').eq('id',body.id).single();if(found.error)throw new MailError(404,'Documento indisponível.');
 const d=found.data;if(d.workflow_state!=='validated')throw new MailError(409,'O documento tem de estar validado.');
 const version=await db.from('catalog_document_versions').select('*').eq('id',d.approved_version_id).single();if(version.error)throw new MailError(404,'PDF aprovado indisponível.');
 const v=version.data,s=v.snapshot as CommercialSnapshot,isOrder=d.document_type==='order';
 const recipients=validateRecipients(isOrder?{to:['comercial@representacoesfreixo.com'],cc:[],bcc:[]}:{to:body.to,cc:body.cc,bcc:body.bcc});
 const subject=isOrder?`NOVA ENCOMENDA | ${d.order_number} | ${s.client.trade_name} | ${s.manufacturer.name}`:body.subject?.trim();
 if(!subject)throw new MailError(400,'Indique o assunto.');
 const total=new Intl.NumberFormat('pt-PT',{style:'currency',currency:d.currency}).format(Number(d.total));
 const text=isOrder?`Olá Tina,\n\nFoi registada e validada uma nova encomenda através da Representações Freixo CRM.\n\nEncomenda: ${d.order_number}\nCliente: ${s.client.trade_name}\nContacto: ${[s.contact?.first_name,s.contact?.last_name,s.contact?.email||s.client.email].filter(Boolean).join(' ')}\nFabricante: ${s.manufacturer.name}\nComercial responsável: ${s.seller.full_name}\nData: ${d.order_date}\nValor total: ${total}${d.shipping_known?'':' (portes a confirmar)'}\n\nA Nota de Encomenda segue em anexo, em formato PDF, para que possas dar o devido seguimento junto do fabricante.\n${d.notes?'\nObservações: '+d.notes+'\n':''}\nObrigado.`:body.text?.trim();
 if(!text)throw new MailError(400,'Escreva a mensagem.');
 const signature=await userSignature(db,user,new URL(request.url).origin),html=signedMailBody(text,signature.html);
 const size=Math.floor(v.pdf_base64.length*3/4);if(size>=3*1024*1024)throw new MailError(400,'O PDF ultrapassa o limite de envio de 3 MB.');
 const service=commercialService();
 const claim=await service.rpc('commercial_claim_send',{vid:v.id,actor:user.id,recipients,subject,html});if(claim.error)throw new MailError(409,claim.error.message);
 try{
  const graphRecipients=(addresses:string[])=>addresses.map(address=>({emailAddress:{address}}));
  await sendApprovedCommercialMail(user.email,{subject,body:{contentType:'HTML',content:html},toRecipients:graphRecipients(recipients.to),ccRecipients:graphRecipients(recipients.cc),bccRecipients:graphRecipients(recipients.bcc)},{name:v.filename,contentType:'application/pdf',size,contentBytes:v.pdf_base64});
 }catch(error){
  const status=(error as {graphStatus?:number}).graphStatus;
  // A timeout/5xx may follow acceptance. Never retry automatically in that case.
  const definite=Boolean(status&&status>=400&&status<500)||error instanceof MailError;
  await service.rpc('commercial_finish_send',{attempt:claim.data.id,actor:user.id,result:definite?'failed':'uncertain',graph_message_id:null,error_message:error instanceof Error?error.message:'Falha de envio'});
  throw new MailError(502,definite?'A Microsoft recusou o envio. A encomenda continua validada; pode tentar novamente.':'Não foi possível confirmar o resultado. Consulte os Enviados no Outlook antes de qualquer nova tentativa; o reenvio está bloqueado para evitar duplicação.');
 }
 const finished=await service.rpc('commercial_finish_send',{attempt:claim.data.id,actor:user.id,result:'accepted',graph_message_id:null,error_message:null});
 if(finished.error)return json({ok:true,warning:'Envio aceite pela Microsoft. O histórico não foi atualizado; não repita o envio.'});
 return json({ok:true,message:'Envio aceite pela Microsoft. A entrega na caixa do destinatário não foi confirmada.'});
}catch(error){return mailError(error);}}
