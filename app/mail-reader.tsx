"use client";
import { useEffect, useState } from "react";
import { mailRequest } from "./mail-client";
import type { FullMail, ReplyMode, MailAttachment } from "./mail-content";
import type { LiveMessage } from "./mail-matching";
import MailReplyComposer from "./mail-reply-composer";
// Messages are untrusted HTML: strip active elements and isolate the rest in a
// sandboxed document. Only image loads can be enabled explicitly per message.
export function emailDocument(content: string, contentType: string, externalImages = false) {
  // Template contents stay inert while sanitizing, including external images.
  const template = document.createElement("template");
  if (contentType.toLowerCase() === "html") template.innerHTML = content;
  else { const pre = document.createElement("pre"); pre.textContent = content; template.content.append(pre); }
  template.content.querySelectorAll("script,iframe,object,embed,form,input,button,textarea,select,meta,base,link,svg,math,audio,video").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => { if (/^on/i.test(attr.name) || ["srcdoc", "action", "formaction", "href", "xlink:href", "target"].includes(attr.name.toLowerCase())) node.removeAttribute(attr.name); });
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data: ${externalImages ? 'https: http:' : ''}; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.6 Arial,sans-serif;color:#18334b;padding:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${template.innerHTML}</body></html>`;
}



export default function MailReader({ message, ownEmail, onClose, onSent, onRead }: { message: LiveMessage; ownEmail: string; onClose: () => void; onSent: () => void; onRead: (id: string) => void }) {
  const [full, setFull] = useState<FullMail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [externalImages, setExternalImages] = useState(false);
  const [mode, setMode] = useState<ReplyMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState("");
  const [readError, setReadError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    mailRequest("/api/mail/message?id=" + encodeURIComponent(message.id), { signal: controller.signal }).then(async result => {
      if (controller.signal.aborted) return;
      setFull(result); setLoading(false); setReadError("");
      if (result.isRead) { onRead(message.id); return; }
      try {
        await mailRequest("/api/mail/mark-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id }) });
        onRead(message.id);
      } catch (error) { if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : "Não foi possível marcar como lido."); }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível abrir a mensagem."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [message.id, revision, onRead]);
  const download = async (file: MailAttachment) => {
    setDownloading(file.id); setDownloadError("");
    try {
      const result = await mailRequest("/api/mail/attachment?" + new URLSearchParams({ messageId: message.id, attachmentId: file.id }));
      const bytes = Uint8Array.from(atob(result.contentBytes), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType || "application/octet-stream" }));
      const link = document.createElement("a"); link.href = url; link.download = (result.name || "anexo").replace(/[\/\\\x00-\x1f]/g, "_"); document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setDownloadError(e instanceof Error ? e.message : "Não foi possível descarregar o anexo."); }
    finally { setDownloading(""); }
  };
  const shown = full || message;
  return <dialog className="mail-reader-backdrop" ref={node => { if (node && !node.open) node.showModal(); }} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => event.stopPropagation()} aria-labelledby="mail-reader-title"><section className="mail-reader">
    <header><div><h2 id="mail-reader-title">{shown.subject || "Sem assunto"}</h2><p>De: {shown.from?.emailAddress?.name} &lt;{shown.from?.emailAddress?.address}&gt;</p><p>Para: {shown.toRecipients?.map(party => party.emailAddress?.address).join("; ")}</p>{full?.ccRecipients?.length ? <p>CC: {full.ccRecipients.map(party => party.emailAddress?.address).join("; ")}</p> : null}<time>{new Date(shown.receivedDateTime || shown.sentDateTime || Date.now()).toLocaleString("pt-PT")}</time></div><button disabled={busy} autoFocus onClick={onClose} aria-label="Fechar mensagem">×</button></header>
    <div className="mail-reader-scroll">
    {loading && <p role="status">A abrir mensagem e anexos…</p>}
    {error && <p role="alert">{error} <button onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></p>}
    {readError && <p role="alert">{readError} <button onClick={() => setRevision(value => value + 1)}>Tentar marcar como lido</button></p>}
    {full && <><div className="mail-reader-actions">{([["reply", "Responder"], ["replyAll", "Responder a todos"], ["forward", "Reencaminhar"]] as const).map(([value, label]) => <button key={value} disabled={busy} onClick={() => { setMode(value); setNotice(""); }}>{label}</button>)}</div>
    {notice && <p className="email-notice" role="status">{notice}</p>}
    {mode && <MailReplyComposer key={mode} message={full} mode={mode} ownEmail={ownEmail} onBusy={setBusy} onCancel={() => setMode(null)} onSent={() => { setMode(null); setNotice("Mensagem enviada."); onSent(); }}/>}
    {!!full.attachments?.filter(file => !file.isInline).length && <ul className="mail-attachment-chips" aria-label="Anexos">{full.attachments.filter(file => !file.isInline).map(file => <li key={file.id}><span>{file.name} <small>{Math.ceil(file.size / 1024)} KB</small></span><button disabled={Boolean(downloading)} onClick={() => void download(file)} aria-label={"Descarregar " + file.name}>{downloading === file.id ? "A descarregar…" : "Descarregar"}</button></li>)}</ul>}
    {downloadError && <p role="alert">{downloadError}</p>}
    <div className="mail-images-control"><span>{externalImages ? "Imagens externas visíveis." : "Imagens externas bloqueadas."}</span><button onClick={() => setExternalImages(value => !value)}>{externalImages ? "Ocultar imagens externas" : "Mostrar imagens externas"}</button></div>
    <iframe title="Conteúdo do email" sandbox="" referrerPolicy="no-referrer" srcDoc={emailDocument(full.body?.content || "", full.body?.contentType || "text", externalImages)}/></>}
    </div>
  </section></dialog>;
}
