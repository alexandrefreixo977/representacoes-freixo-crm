import { mailSession, MailError } from "../mail/server";
import { userSignature } from "../mail/signature";
import { signedMailBody } from "../../mail-signature-body";
import { validateRecipients } from "../../mail-recipients";
const GRAPH = "https://graph.microsoft.com/v1.0";
const DIRECT_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const CHUNK_SIZE = 10 * 320 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;

type Attachment = { name: string; contentType: string; size: number; contentBytes: string };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function env(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (!value) throw new Error(`Configuração em falta no servidor: ${name}`);
  return value;
}

async function appToken(): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${env("MICROSOFT_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("MICROSOFT_CLIENT_ID"),
      client_secret: env("MICROSOFT_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || "A Microsoft recusou a autorização da aplicação.");
  return data.access_token;
}

async function graph(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const raw = await res.text();
  const detail = raw ? JSON.parse(raw) : null;
  if (!res.ok) throw Object.assign(new Error(detail?.error?.message || "A Microsoft recusou o envio."),{graphStatus:res.status});
  return detail;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Shared application-token transport for approved commercial PDFs.
export async function sendApprovedCommercialMail(sender:string,message:{subject:string;body:{contentType:string;content:string};toRecipients:unknown[];ccRecipients:unknown[];bccRecipients:unknown[]},attachment:Attachment){
 if(attachment.size>=DIRECT_ATTACHMENT_LIMIT)throw new MailError(400,'O PDF ultrapassa o limite de 3 MB para envio comercial.');
 const token=await appToken(),box=`/users/${encodeURIComponent(sender)}`;
 await graph(token,`${box}/sendMail`,{method:'POST',body:JSON.stringify({message:{...message,attachments:[{'@odata.type':'#microsoft.graph.fileAttachment',name:attachment.name,contentType:attachment.contentType,contentBytes:attachment.contentBytes}]},saveToSentItems:true})});
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json(401, { error: "Sem sessão. Volte a iniciar sessão." });

    const {user,db}=await mailSession(request);
    const sender=user.email;
    if (!sender) return json(401, { error: "Sessão inválida. Volte a iniciar sessão." });

    const body = (await request.json()) as {
      conditions?:{clientId:string;manufacturerId:string;selected:Record<string,unknown>}; opportunityId?:string; proposalId?:string; to: string|string[]; signatureVersion?:string; unsignedBodyText?:string; cc?: string[]; bcc?: string[]; subject: string; bodyHtml: string; attachments?: Attachment[];
    };
    if(body.proposalId)return json(409,{error:"Envie a proposta na área Catálogo > Orçamentos, com o PDF aprovado."});
    const permission=await db.rpc('has_crm_permission',{permission_name:'emails.own'});
    if(permission.error||permission.data!==true)return json(403,{error:'O seu perfil não permite enviar emails. Contacte a Administração.'});
    if(body.conditions){
      if(body.opportunityId)return json(400,{error:'Escolha apenas uma origem para este envio.'});
      const [client,manufacturer]=await Promise.all([
        db.from('clients').select('id').eq('id',body.conditions.clientId).is('archived_at',null).single(),
        db.from('manufacturers').select('id').eq('id',body.conditions.manufacturerId).eq('active',true).is('deleted_at',null).single(),
      ]);
      if(client.error||manufacturer.error)return json(403,{error:'Cliente, Lead ou fabricante não autorizado.'});
    }
    let recipients;
    try{recipients=validateRecipients({to:typeof body.to==="string"?[body.to]:body.to,cc:body.cc,bcc:body.bcc});}catch(error){return json(400,{error:(error as Error).message});}
    if(typeof body.signatureVersion!=="string" || !body.signatureVersion)return json(409,{error:"Carregue a assinatura antes de enviar. Feche e volte a abrir o compositor."});
    {
      const signature=await userSignature(db,user,new URL(request.url).origin);
      if(signature.version!==body.signatureVersion)return json(409,{error:"A assinatura foi atualizada. Volte a abrir o compositor antes de enviar."});
      if(typeof body.unsignedBodyText!=="string")return json(400,{error:"Texto da mensagem em falta."});
      body.bodyHtml=signedMailBody(body.unsignedBodyText,signature.html);
    }
    if(body.proposalId&&!body.opportunityId)return json(400,{error:"Oportunidade em falta."});
    if(body.opportunityId){
      const opportunity=await db.from("opportunities").select("id,client_id").eq("id",body.opportunityId).single();
      if(opportunity.error||!opportunity.data)return json(403,{error:"Oportunidade não autorizada."});
      if(body.proposalId){const proposal=await db.from("catalog_orders").select("id").eq("id",body.proposalId).eq("opportunity_id",body.opportunityId).eq("document_type","proposal").single();if(proposal.error||!proposal.data)return json(403,{error:"Proposta não autorizada."});}
    }
    const sentResponse=async()=>{
      if(body.conditions){
        const result=await db.rpc('record_manufacturer_conditions',{cid:body.conditions.clientId,mid:body.conditions.manufacturerId,mail_subject:body.subject,html:body.bodyHtml,plain:body.unsignedBodyText||'',recipients,conditions:body.conditions.selected});
        if(result.error)return json(200,{ok:true,deliveryWarning:'A Microsoft aceitou o email, mas não foi possível registar o histórico. Não repita o envio; contacte a Administração.'});
      }
      if(body.opportunityId){try{const result=await db.rpc("opportunity_record_email",{oid:body.opportunityId,proposal:body.proposalId||null,mail_subject:body.subject,html:body.bodyHtml,plain:body.unsignedBodyText||body.subject,recipients});if(result.error)throw result.error;}catch{return json(200,{ok:true,deliveryWarning:"Email enviado. Não foi possível atualizar o histórico comercial; não repita o envio."});}}
      return json(200,{ok:true});
    };
    const attachments = body.attachments || [];
    const total = attachments.reduce((sum, attachment) => sum + (attachment.size || 0), 0);
    if (total > MAX_TOTAL) return json(400, { error: "Os anexos ultrapassam o limite máximo de 20 MB." });

    const token = await appToken();
    const box = `/users/${encodeURIComponent(sender)}`;
    const message = {
      subject: body.subject,
      body: { contentType: "HTML", content: body.bodyHtml },
      toRecipients: recipients.to.map(address=>({emailAddress:{address}})),
      ccRecipients: recipients.cc.map((address) => ({ emailAddress: { address } })),
      bccRecipients: recipients.bcc.map((address) => ({ emailAddress: { address } })),
    };

    const hasLarge = attachments.some((attachment) => attachment.size >= DIRECT_ATTACHMENT_LIMIT);
    if (!hasLarge) {
      await graph(token, `${box}/sendMail`, {
        method: "POST",
        body: JSON.stringify({
          message: {
            ...message,
            attachments: attachments.map((attachment) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: attachment.name,
              contentType: attachment.contentType || "application/octet-stream",
              contentBytes: attachment.contentBytes,
            })),
          },
          saveToSentItems: true,
        }),
      });
      return await sentResponse();
    }

    const draft = await graph(token, `${box}/messages`, { method: "POST", body: JSON.stringify(message) });
    for (const file of attachments) {
      if (file.size < DIRECT_ATTACHMENT_LIMIT) {
        await graph(token, `${box}/messages/${draft.id}/attachments`, {
          method: "POST",
          body: JSON.stringify({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: file.name,
            contentType: file.contentType || "application/octet-stream",
            contentBytes: file.contentBytes,
          }),
        });
        continue;
      }

      const session = await graph(token, `${box}/messages/${draft.id}/attachments/createUploadSession`, {
        method: "POST",
        body: JSON.stringify({ AttachmentItem: { attachmentType: "file", name: file.name, size: file.size, contentType: file.contentType || "application/octet-stream" } }),
      });
      const bytes = base64ToBytes(file.contentBytes);
      for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, bytes.length);
        const put = await fetch(session.uploadUrl, {
          method: "PUT",
          headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
          body: new Uint8Array(bytes.subarray(start, end)).buffer,
        });
        if (!put.ok) throw new Error(`Não foi possível carregar o anexo ${file.name}.`);
      }
    }

    await graph(token, `${box}/messages/${draft.id}/send`, { method: "POST" });
    return await sentResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível enviar o email.";
    return json(error instanceof MailError?error.status:500, { error: message });
  }
}
