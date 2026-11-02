import { applicationToken, json, MailError, mailError, mailSession } from "../server";
import { validateRecipients } from "../../../mail-recipients";
import { requireMailPermission } from '../server';
import { userSignature } from "../signature";
import { signedMailBody, prependReply } from "../../../mail-signature-body";
import { MAX_REPLY_ATTACHMENTS, MAX_REPLY_COMMENT, validGraphId } from "../../../mail-content";

async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new MailError(400, "Mensagem em falta.");
  let total = 0, text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 3900000) { await reader.cancel(); throw new MailError(413, "A mensagem é demasiado grande. Limite de anexos: 2,5 MB."); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new MailError(400, "Formato da mensagem inválido."); }
}
export async function POST(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    const body = await boundedJson(request);
    if (!body || !validGraphId(body.messageId) || !["reply", "replyAll", "forward"].includes(body.mode)) throw new MailError(400, "Mensagem ou ação inválida.");
    if (typeof body.comment !== "string" || !body.comment.trim() || body.comment.length > MAX_REPLY_COMMENT) throw new MailError(400, "Escreva uma mensagem com até 50.000 caracteres.");
    let recipients;
    try { recipients = validateRecipients(body); } catch(error) { throw new MailError(400,(error as Error).message); }
    const signature=await userSignature(db,user,new URL(request.url).origin);
    if(body.signatureVersion!==signature.version)throw new MailError(409,"A assinatura foi atualizada. Feche e volte a abrir a resposta para confirmar a pré-visualização antes de enviar.");
    const files = body.attachments ?? [];
    if (!Array.isArray(files) || files.length > 20) throw new MailError(400, "Pode anexar até 20 ficheiros.");
    let total = 0;
    const attachments = files.map(file => {
      if (!file || typeof file.name !== "string" || !file.name.trim() || file.name.length > 255 || /[\r\n\0]/.test(file.name) || typeof file.contentBytes !== "string" || file.contentBytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBytes)) throw new MailError(400, "Anexo inválido.");
      total += file.contentBytes.length * 3 / 4 - (file.contentBytes.endsWith("==") ? 2 : file.contentBytes.endsWith("=") ? 1 : 0);
      if (total > MAX_REPLY_ATTACHMENTS) throw new MailError(413, "Os anexos da resposta ultrapassam 2,5 MB.");
      const contentType = typeof file.contentType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.contentType) ? file.contentType : "application/octet-stream";
      return { "@odata.type": "#microsoft.graph.fileAttachment", name: file.name, contentType, contentBytes: file.contentBytes };
    });
    const token = await applicationToken();
    const root = 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(user.email);
    let draftCreated=false, sending=false;
    const graph = async (path:string, method:string, payload?:unknown) => {
      let response:Response;
      try { response=await fetch(root+path,{method,cache:"no-store",headers:{Authorization:'Bearer '+token,"Content-Type":"application/json",Prefer:'IdType="ImmutableId", outlook.body-content-type="html"'},...(payload!==undefined?{body:JSON.stringify(payload)}:{})}); }
      catch { throw new MailError(502,sending?"O envio não foi confirmado. Consulte os Enviados antes de tentar novamente.":draftCreated?"A preparação foi interrompida. A resposta ficou nos Rascunhos do Outlook; não foi enviada.":"Não foi possível preparar a resposta. Consulte os Rascunhos antes de tentar novamente."); }
      if(!response.ok)throw new MailError([403,404,429].includes(response.status)?response.status:502,
        sending?"A Microsoft não confirmou o envio. Consulte os Enviados antes de tentar novamente.":draftCreated?"Não foi possível concluir a resposta. O rascunho foi preservado no Outlook; não foi enviado.":response.status===403?"A Microsoft recusou a preparação da resposta. São necessárias Mail.ReadWrite e Mail.Send nesta caixa.":"Não foi possível preparar a resposta no Outlook.",response.headers.get("Retry-After")||undefined);
      return response.status===204||response.status===202?null:response.json();
    };
    const action={reply:"createReply",replyAll:"createReplyAll",forward:"createForward"}[body.mode as "reply"|"replyAll"|"forward"];
    // Create only at Send: preserve Microsoft's thread and original quote/attachments.
    const draft=await graph('/messages/'+encodeURIComponent(body.messageId)+'/'+action,"POST",{});
    draftCreated=true;
    if(!validGraphId(draft?.id))throw new MailError(502,"A Microsoft não devolveu um rascunho válido. Consulte os Rascunhos antes de tentar novamente.");
    const path='/messages/'+encodeURIComponent(draft.id);
    const original=draft.body|| (await graph(path+'?$select=body',"GET")).body;
    const parties=(values:string[])=>values.map(address=>({emailAddress:{address}}));
    await graph(path,"PATCH",{
      toRecipients:parties(recipients.to),ccRecipients:parties(recipients.cc),bccRecipients:parties(recipients.bcc),
      body:{contentType:"HTML",content:prependReply(original,signedMailBody(body.comment,signature.html))},
    });
    for(const attachment of attachments)await graph(path+'/attachments',"POST",attachment);
    sending=true;
    await graph(path+'/send',"POST");
    return json({ ok: true });
  } catch (error) { return mailError(error); }
}
