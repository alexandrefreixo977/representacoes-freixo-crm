"use client";
import { useEffect, useRef, useState } from "react";
import { fileBase64, mailRequest } from "./mail-client";
import { MAX_REPLY_ATTACHMENTS, MAX_REPLY_COMMENT, replyRecipients, type FullMail, type ReplyMode } from "./mail-content";

import MailRecipientField from "./mail-recipient-field";
import { addRecipients, validateRecipients, recipientFields, type RecipientLists, type RecipientField } from "./mail-recipients";
import type { LoadedSignature } from "./email-composer";
const labels = { reply: "Responder", replyAll: "Responder a todos", forward: "Reencaminhar" };
export default function MailReplyComposer({ message, mode, ownEmail, onCancel, onSent, onBusy }: { message: FullMail; mode: ReplyMode; ownEmail: string; onCancel: () => void; onSent: () => void; onBusy: (busy: boolean) => void }) {
  const [recipients, setRecipients] = useState<RecipientLists>(() => replyRecipients(message, mode, ownEmail));
  const [drafts, setDrafts] = useState({to:"",cc:"",bcc:""});
  const [context, setContext] = useState<{signature:LoadedSignature;contacts:{email:string;name:string}[];aliasesVerified:boolean;contactsUnavailable:boolean}|null>(null);
  const [contextError, setContextError] = useState("");
  const [contextRevision, setContextRevision] = useState(0);
  useEffect(() => {
    const controller=new AbortController();setContext(null);setContextError("");
    mailRequest("/api/mail/compose-context",{signal:controller.signal}).then(result=>{
      if(controller.signal.aborted)return;
      setContext(result);setRecipients(replyRecipients(message,mode,result.ownAddresses));setDrafts({to:"",cc:"",bcc:""});
    }).catch(error=>{if(!controller.signal.aborted)setContextError(error.message)});
    return()=>controller.abort();
  },[message.id,mode,ownEmail,contextRevision]);
  const commit = (field:RecipientField, value:string) => {
    const result=addRecipients(recipients,field,value);setRecipients(result.recipients);setError(result.error);
    if(!result.error.startsWith("Endereço de email inválido"))setDrafts(previous=>({...previous,[field]:""}));
    else setDrafts(previous=>({...previous,[field]:value}));
  };
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (sendingRef.current) return;
    if (files.length > 20 || total > MAX_REPLY_ATTACHMENTS) { setError("Pode anexar até 20 ficheiros, com um total máximo de 2,5 MB."); return; }
    if(!context)return;
    let selected=recipients;
    for(const field of recipientFields){
      const result=addRecipients(selected,field,drafts[field]);
      if(result.error){setError(result.error);return;}
      selected=result.recipients;
    }
    try{selected=validateRecipients(selected)}catch(error){setError((error as Error).message);return;}
    setRecipients(selected);setDrafts({to:"",cc:"",bcc:""});
    sendingRef.current = true; setSending(true); onBusy(true); setError("");
    try {
      const attachments = await Promise.all(files.map(async file => ({ name: file.name, contentType: file.type || "application/octet-stream", contentBytes: await fileBase64(file) })));
      await mailRequest("/api/mail/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id, mode, comment, ...selected, signatureVersion:context.signature.version, attachments }) });
      onSent();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível confirmar o envio. Consulte os Enviados antes de tentar novamente."); }
    finally { sendingRef.current = false; setSending(false); onBusy(false); }
  };
  return <form className="mail-reply-form" onSubmit={submit}>
    <h3>{labels[mode]}</h3>
    {!context && !contextError && <p role="status">A carregar destinatários e assinatura…</p>}
    {contextError && <p role="alert">{contextError} <button type="button" onClick={()=>setContextRevision(value=>value+1)}>Tentar novamente</button></p>}
    <fieldset disabled={sending || !context}>
    {recipientFields.map(field=><MailRecipientField key={field} label={field==="to"?"Para":field.toUpperCase()} values={recipients[field]} draft={drafts[field]} onDraft={value=>setDrafts(previous=>({...previous,[field]:value}))} onCommit={value=>commit(field,value)} onRemove={address=>setRecipients(previous=>({...previous,[field]:previous[field].filter(value=>value!==address)}))} contacts={context?.contacts??[]}/>)}
    {mode==="replyAll" && context && !context.aliasesVerified && <p className="mail-compose-note">O seu endereço principal foi excluído. A Microsoft não disponibilizou os outros endereços da conta; reveja eventuais aliases antes de enviar.</p>}
    {context?.contactsUnavailable && <p className="mail-compose-note">Pesquisa de contactos indisponível. Pode introduzir os endereços manualmente.</p>}
    <label>Assunto<input value={(mode === "forward" ? "FW: " : /^RE:/i.test(message.subject || "") ? "" : "RE: ") + (message.subject || "Sem assunto")} readOnly/></label>
    <label>Mensagem<textarea autoFocus={mode !== "forward"} rows={6} required maxLength={MAX_REPLY_COMMENT} value={comment} onChange={event => setComment(event.target.value)}/></label>
    <label>Anexos<input type="file" multiple onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); setFiles(previous => [...previous, ...selected]); event.currentTarget.value = ""; }}/><small>Até 20 ficheiros · 2,5 MB no total.</small></label>
    {files.length > 0 && <ul className="mail-reply-files">{files.map((file, index) => <li key={index}><span>{file.name} · {Math.ceil(file.size / 1024)} KB</span><button type="button" onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))} aria-label={"Remover " + file.name}>Remover</button></li>)}</ul>}
    {context && <section className="signature-preview"><strong>Assinatura automática</strong>{context.signature.html?<div dangerouslySetInnerHTML={{__html:context.signature.html}}/>:<p>A assinatura está desativada.</p>}{context.signature.warnings.map(warning=><p key={warning} role="status">{warning}</p>)}</section>}
    <p className="mail-compose-note">O Outlook inclui a mensagem original por baixo.{mode === "forward" ? " Os anexos originais seguem no reencaminhamento." : " Os anexos originais não são adicionados à resposta."}</p>
    {error && <p role="alert">{error}</p>}
    <div className="form-actions"><button className="primary" disabled={sending || total > MAX_REPLY_ATTACHMENTS}>{sending ? "A enviar…" : "Enviar"}</button></div></fieldset><button type="button" disabled={sending} onClick={onCancel}>Cancelar</button>
  </form>;
}
