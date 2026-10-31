"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { RF_SIGNATURE_MARKER } from "./email-signature";
import { mailRequest } from "./mail-client";

export const MAX_EMAIL_ATTACHMENTS = 20 * 1024 * 1024;
const signatureMarker = RF_SIGNATURE_MARKER;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ComposedEmail = { to:string; cc:string[]; bcc:string[]; subject:string; bodyText:string; bodyHtml:string; attachments:File[]; signatureVersion?:string; unsignedBodyText?:string; opportunityId?:string; proposalId?:string; deliveryWarning?:string; conditions?:{clientId:string;manufacturerId:string;selected:Record<string,unknown>} };
export const parseEmailList=(value:string)=>[...new Set(value.split(/[;,\n]+/).map(x=>x.trim().toLowerCase()).filter(Boolean))];
export const formatBytes=(bytes:number)=>new Intl.NumberFormat("pt-PT",{maximumFractionDigits:1}).format(bytes/1024/1024)+" MB";
export const sanitizeSignature=(html:string)=>html
  .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi,"")
  .replace(/\son\w+\s*=\s*(["']).*?\1/gi,"")
  .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:text\/html)[\s\S]*?\2/gi,"");
export const withSignature=(bodyText:string,signatureHtml:string)=>{
  const message=bodyText.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
  return signatureHtml&& !message.includes(signatureMarker) ? `${message}<br><br>${sanitizeSignature(signatureHtml)}` : message;
};

export type LoadedSignature = { html:string; text:string; warnings:string[]; enabled:boolean; version:string };
export async function loadEmailSignature(userId:string):Promise<LoadedSignature>{
  const result=await mailRequest("/api/mail/compose-context?signatureOnly=1");
  if(result.userId!==userId)throw new Error("A conta mudou. Volte a abrir o compositor.");
  return result.signature;
}

const toBase64=async(file:File)=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)};
export async function sendMicrosoftEmail(_token:string|null,email:ComposedEmail){
  const total=email.attachments.reduce((sum,file)=>sum+file.size,0);if(total>MAX_EMAIL_ATTACHMENTS)throw new Error("Os anexos ultrapassam o limite máximo de 20 MB.");
  const {data:{session}}=await supabase.auth.getSession();
  const jwt=session?.access_token;
  if(!jwt)throw new Error("A sessão terminou. Volte a iniciar sessão para enviar.");
  const attachments=await Promise.all(email.attachments.map(async file=>({name:file.name,contentType:file.type||"application/octet-stream",size:file.size,contentBytes:await toBase64(file)})));
  const response=await fetch("/api/send-email",{method:"POST",headers:{Authorization:`Bearer ${jwt}`,"Content-Type":"application/json"},body:JSON.stringify({to:email.to,cc:email.cc,bcc:email.bcc,subject:email.subject,bodyHtml:email.bodyHtml,attachments,signatureVersion:email.signatureVersion,unsignedBodyText:email.unsignedBodyText,opportunityId:email.opportunityId,proposalId:email.proposalId,conditions:email.conditions})});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||"Não foi possível enviar o email.");
  email.deliveryWarning=result?.deliveryWarning;
}

export default function EmailComposer({providerToken,userId,opportunityId,proposalId,initialTo="",toOptions=[],initialSubject="",initialBody="Olá,\n\n",sendLabel="Enviar e registar",onBusy,attachmentLimit=MAX_EMAIL_ATTACHMENTS,onCancel,onSent}:{providerToken:string|null;userId:string;opportunityId?:string;proposalId?:string;initialTo?:string;toOptions?:Array<{label:string;email:string}>;initialSubject?:string;initialBody?:string;sendLabel?:string;attachmentLimit?:number;onBusy?:(busy:boolean)=>void;onCancel:()=>void;onSent:(email:ComposedEmail)=>Promise<void>}){
  const [to,setTo]=useState(initialTo);const [cc,setCc]=useState("");const [bcc,setBcc]=useState("");const [subject,setSubject]=useState(initialSubject);const [body,setBody]=useState(initialBody);const [files,setFiles]=useState<File[]>([]);const [signature,setSignature]=useState<LoadedSignature|null>(null);const [notice,setNotice]=useState("");const [sending,setSending]=useState(false);
  useEffect(()=>{let active=true;setSignature(null);setNotice("");loadEmailSignature(userId).then(value=>{if(active)setSignature(value)}).catch(error=>{if(active)setNotice(error.message)});return()=>{active=false}},[userId]);
  useEffect(()=>setTo(initialTo),[initialTo]);useEffect(()=>setSubject(initialSubject),[initialSubject]);useEffect(()=>setBody(initialBody),[initialBody]);
  const total=useMemo(()=>files.reduce((sum,file)=>sum+file.size,0),[files]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();if(sending||!signature)return;const ccList=parseEmailList(cc),bccList=parseEmailList(bcc);const invalid=[to,...ccList,...bccList].filter(x=>!emailPattern.test(x));if(invalid.length){setNotice(`Endereço de email inválido: ${invalid.join(", ")}`);return}if(total>attachmentLimit){setNotice(`Os anexos ultrapassam o limite máximo de ${formatBytes(attachmentLimit)}.`);return}setSending(true);onBusy?.(true);setNotice("");try{const plain=signature.text&&!body.includes(signature.text)?`${body}\n\n${signature.text}`:body;const email:ComposedEmail={to,cc:ccList,bcc:bccList,opportunityId,proposalId,subject,bodyText:plain,bodyHtml:withSignature(body,signature.html),attachments:files,signatureVersion:signature.version,unsignedBodyText:body};await sendMicrosoftEmail(providerToken,email);await onSent(email)}catch(error){setNotice(error instanceof Error?error.message:"Não foi possível enviar o email.")}finally{setSending(false);onBusy?.(false)}};
  return <form className="email-composer-global" onSubmit={submit}><div className="form-grid"><label>Para<input list={`email-options-${userId}`} type="email" value={to} onChange={e=>setTo(e.target.value)} required/><datalist id={`email-options-${userId}`}>{toOptions.filter(x=>x.email).map(x=><option key={`${x.email}-${x.label}`} value={x.email}>{x.label}</option>)}</datalist></label><label>CC — vários endereços<input value={cc} onChange={e=>setCc(e.target.value)} placeholder="email1@empresa.pt; email2@empresa.pt"/><small>Separe vários endereços com ponto e vírgula.</small></label><label>BCC — cópia oculta<input value={bcc} onChange={e=>setBcc(e.target.value)} placeholder="email@empresa.pt"/></label><label className="full">Assunto<input value={subject} onChange={e=>setSubject(e.target.value)} required/></label><label className="full">Corpo da mensagem<textarea rows={9} value={body} onChange={e=>setBody(e.target.value)} required/></label><label className="full">Anexos<input type="file" multiple onChange={e=>setFiles([...files,...Array.from(e.target.files??[])])}/><small>Limite máximo de anexos: {formatBytes(attachmentLimit)}</small></label></div>{files.length>0&&<div className="attachment-list">{files.map((file,index)=><div key={`${file.name}-${index}`}><span>{file.name} — {formatBytes(file.size)}</span><button type="button" onClick={()=>setFiles(files.filter((_,i)=>i!==index))}>Remover</button></div>)}<strong className={total>attachmentLimit?"over-limit":""}>Total: {formatBytes(total)} / {formatBytes(attachmentLimit)}</strong></div>}<section className="signature-preview"><strong>Assinatura automática</strong>{signature ? <>{signature.html ? <div dangerouslySetInnerHTML={{__html:sanitizeSignature(signature.html)}}/> : <p>A assinatura está desativada.</p>}{signature.warnings.map(warning=><p key={warning} role="status">{warning}</p>)}</> : <p>A carregar a assinatura…</p>}</section>{notice&&<div className="email-notice" role="alert">{notice}</div>}<div className="form-actions"><button type="button" disabled={sending} onClick={onCancel}>Cancelar</button><button className="primary" disabled={sending||!signature}>{sending?"A enviar…":sendLabel}</button></div></form>;
}
