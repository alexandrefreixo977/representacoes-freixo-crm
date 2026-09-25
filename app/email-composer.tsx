"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { generateEmailSignature, RF_SIGNATURE_MARKER, type EmailSignatureProfile } from "./email-signature";

export const MAX_EMAIL_ATTACHMENTS = 20 * 1024 * 1024;
const signatureMarker = RF_SIGNATURE_MARKER;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ComposedEmail = { to:string; cc:string[]; bcc:string[]; subject:string; bodyText:string; bodyHtml:string; attachments:File[] };
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

const toBase64=async(file:File)=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)};
export async function sendMicrosoftEmail(_token:string|null,email:ComposedEmail){
  const total=email.attachments.reduce((sum,file)=>sum+file.size,0);if(total>MAX_EMAIL_ATTACHMENTS)throw new Error("Os anexos ultrapassam o limite máximo de 20 MB.");
  const {data:{session}}=await supabase.auth.getSession();
  const jwt=session?.access_token;
  if(!jwt)throw new Error("A sessão terminou. Volte a iniciar sessão para enviar.");
  const attachments=await Promise.all(email.attachments.map(async file=>({name:file.name,contentType:file.type||"application/octet-stream",size:file.size,contentBytes:await toBase64(file)})));
  const response=await fetch("/api/send-email",{method:"POST",headers:{Authorization:`Bearer ${jwt}`,"Content-Type":"application/json"},body:JSON.stringify({to:email.to,cc:email.cc,bcc:email.bcc,subject:email.subject,bodyHtml:email.bodyHtml,attachments})});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||"Não foi possível enviar o email.");
}

export default function EmailComposer({providerToken,userId,initialTo="",toOptions=[],initialSubject="",initialBody="",onCancel,onSent}:{providerToken:string|null;userId:string;initialTo?:string;toOptions?:Array<{label:string;email:string}>;initialSubject?:string;initialBody?:string;onCancel:()=>void;onSent:(email:ComposedEmail)=>Promise<void>}){
  const [to,setTo]=useState(initialTo);const [cc,setCc]=useState("");const [subject,setSubject]=useState(initialSubject);const [body,setBody]=useState(initialBody);const [files,setFiles]=useState<File[]>([]);const [signature,setSignature]=useState({html:"",text:""});const [notice,setNotice]=useState("");const [sending,setSending]=useState(false);
  useEffect(()=>{supabase.from("profiles").select("signature_name,signature_title,signature_email,signature_phone,signature_address,signature_postal_code,signature_locality,signature_country,signature_qr_path,signature_enabled").eq("id",userId).maybeSingle().then(({data})=>{const qr=data?.signature_qr_path?supabase.storage.from("email-signatures").getPublicUrl(data.signature_qr_path).data.publicUrl:"";setSignature(generateEmailSignature({name:data?.signature_name,title:data?.signature_title,email:data?.signature_email,phone:data?.signature_phone,address:data?.signature_address,postalCode:data?.signature_postal_code,locality:data?.signature_locality,country:data?.signature_country,qrUrl:qr,enabled:data?.signature_enabled} as EmailSignatureProfile,`${window.location.origin}/email-signature-logo.png`))})},[userId]);
  useEffect(()=>setTo(initialTo),[initialTo]);useEffect(()=>setSubject(initialSubject),[initialSubject]);useEffect(()=>setBody(initialBody),[initialBody]);
  const total=useMemo(()=>files.reduce((sum,file)=>sum+file.size,0),[files]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();const ccList=parseEmailList(cc);const invalid=[to,...ccList].filter(x=>!emailPattern.test(x));if(invalid.length){setNotice(`Endereço de email inválido: ${invalid.join(", ")}`);return}if(total>MAX_EMAIL_ATTACHMENTS){setNotice("Os anexos ultrapassam o limite máximo de 20 MB.");return}setSending(true);setNotice("");try{const plain=signature.text&&!body.includes(signature.text)?`${body}\n\n${signature.text}`:body;const email={to,cc:ccList,bcc:[],subject,bodyText:plain,bodyHtml:withSignature(body,signature.html),attachments:files};await sendMicrosoftEmail(providerToken,email);await onSent(email)}catch(error){setNotice(error instanceof Error?error.message:"Não foi possível enviar o email.")}finally{setSending(false)}};
  return <form className="email-composer-global" onSubmit={submit}><div className="form-grid"><label>Para<input list={`email-options-${userId}`} type="email" value={to} onChange={e=>setTo(e.target.value)} required/><datalist id={`email-options-${userId}`}>{toOptions.filter(x=>x.email).map(x=><option key={`${x.email}-${x.label}`} value={x.email}>{x.label}</option>)}</datalist></label><label>CC — vários endereços<input value={cc} onChange={e=>setCc(e.target.value)} placeholder="email1@empresa.pt; email2@empresa.pt"/><small>Separe vários endereços com ponto e vírgula.</small></label><label className="full">Assunto<input value={subject} onChange={e=>setSubject(e.target.value)} required/></label><label className="full">Corpo da mensagem<textarea rows={9} value={body} onChange={e=>setBody(e.target.value)} required/></label><label className="full">Anexos<input type="file" multiple onChange={e=>setFiles([...files,...Array.from(e.target.files??[])])}/><small>Limite máximo de anexos: 20 MB</small></label></div>{files.length>0&&<div className="attachment-list">{files.map((file,index)=><div key={`${file.name}-${index}`}><span>{file.name} — {formatBytes(file.size)}</span><button type="button" onClick={()=>setFiles(files.filter((_,i)=>i!==index))}>Remover</button></div>)}<strong className={total>MAX_EMAIL_ATTACHMENTS?"over-limit":""}>Total: {formatBytes(total)} / 20 MB</strong></div>}<section className="signature-preview"><strong>Assinatura automática</strong>{signature.html?<div dangerouslySetInnerHTML={{__html:sanitizeSignature(signature.html)}}/>:<p>A assinatura está desativada ou ainda não foi configurada.</p>}</section>{notice&&<div className="email-notice" role="alert">{notice}</div>}<div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={sending}>{sending?"A enviar…":"Enviar e registar"}</button></div></form>;
}
