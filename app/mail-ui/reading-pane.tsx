"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mailRequest } from "../mail-client";
import type { FullMail, MailAttachment } from "../mail-content";
import Icon from "./icons";
import { avatarColor, categoryColor, formatSize, fullDate, initials, messageDate, personName, readStore, writeStore, type Category, type Msg } from "./shared";

type Reply = "reply" | "replyAll" | "forward";
type Props = {
  latest: Msg;
  items: Msg[];
  folderKey: string;
  categories: Category[];
  onReply: (mode: Reply, message: Msg) => void;
  onEditDraft: (message: Msg) => void;
  onMarkRead: (ids: string[]) => void;
  onBack: () => void;
  onOpenEntity?: (message: Msg) => void;
};

const TRUSTED = "rf-mail-trusted-senders";

// Untrusted HTML is rendered inert: no scripts (sandbox + CSP), no forms, remote images only on request.
export function safeEmailDocument(content: string, contentType: string, externalImages: boolean) {
  const template = document.createElement("template");
  if (contentType.toLowerCase() === "html") template.innerHTML = content;
  else { const pre = document.createElement("pre"); pre.textContent = content; template.content.append(pre); }
  template.content.querySelectorAll("script,iframe,object,embed,form,input,button,textarea,select,meta,base,link,svg,math,audio,video,frame,frameset,portal").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (/^on/.test(name) || ["srcdoc", "action", "formaction", "xlink:href", "target", "ping"].includes(name)) node.removeAttribute(attr.name);
      if (name === "href") {
        const value = attr.value.trim().replace(/[\u0000- ]/g, "");
        if (/^(https?:|mailto:|tel:)/i.test(value)) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
        else node.removeAttribute(attr.name);
      }
    });
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data: ${externalImages ? "https: http:" : ""}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}body{font:14.5px/1.55 "Segoe UI",Calibri,Arial,sans-serif;color:#24272d;padding:2px 2px 12px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap;font:inherit}a{color:#8a5f0f}blockquote{border-left:3px solid #e3dfd4;margin:0 0 0 4px;padding-left:12px;color:#5d6067}</style></head><body>${template.innerHTML}</body></html>`;
}

function MailBody({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(160);
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 60) + 4, 40000));
  }, []);
  const loaded = () => {
    measure();
    observer.current?.disconnect();
    const body = frame.current?.contentDocument?.body;
    if (body && typeof ResizeObserver !== "undefined") { observer.current = new ResizeObserver(measure); observer.current.observe(body); }
    frame.current?.contentDocument?.querySelectorAll("img").forEach(image => image.addEventListener("load", measure));
  };
  useEffect(() => () => observer.current?.disconnect(), []);
  return <iframe ref={frame} onLoad={loaded} className="ol-body-frame" title="Conteúdo do email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={html} style={{ height }}/>;
}

async function fetchAttachment(messageId: string, file: MailAttachment) {
  const result = await mailRequest("/api/mail/attachment?" + new URLSearchParams({ messageId, attachmentId: file.id }));
  const bytes = Uint8Array.from(atob(result.contentBytes), char => char.charCodeAt(0));
  return { url: URL.createObjectURL(new Blob([bytes], { type: result.contentType || "application/octet-stream" })), name: String(result.name || "anexo").replace(/[/\\\x00-\x1f]/g, "_"), type: String(result.contentType || "") };
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf"].includes(ext)) return ["PDF", "#b8433f"];
  if (["xls", "xlsx", "csv"].includes(ext)) return ["XLS", "#3f7d4f"];
  if (["doc", "docx"].includes(ext)) return ["DOC", "#3c6aa8"];
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return ["IMG", "#8a6512"];
  if (["zip", "rar", "7z"].includes(ext)) return ["ZIP", "#6b6f78"];
  return [ext.slice(0, 4).toUpperCase() || "FICH", "#6b6f78"];
}

function MessageCard({ message, expanded, onToggle, onReply, onEditDraft }: { message: Msg; expanded: boolean; onToggle: () => void; onReply: (mode: Reply) => void; onEditDraft: () => void }) {
  const [full, setFull] = useState<FullMail | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const sender = message.from?.emailAddress?.address?.toLowerCase() || "";
  const [trusted, setTrusted] = useState(() => readStore<string[]>(TRUSTED, []).includes(sender));
  const [images, setImages] = useState(trusted);
  const [busyFile, setBusyFile] = useState("");
  const [fileError, setFileError] = useState("");
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!expanded || full) return;
    const controller = new AbortController(); setError("");
    mailRequest("/api/mail/message?id=" + encodeURIComponent(message.id), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setFull(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível abrir a mensagem."); });
    return () => controller.abort();
  }, [expanded, message.id, revision, full]);
  const name = personName(message.from);
  const files = (full?.attachments ?? []).filter(file => !file.isInline);
  const hasRemote = full ? /<img[^>]+src\s*=\s*["']?https?:/i.test(full.body?.content || "") : false;
  const open = async (file: MailAttachment, preview: boolean) => {
    setBusyFile(file.id); setFileError("");
    try {
      const result = await fetchAttachment(message.id, file);
      if (preview && /^(image\/|application\/pdf|text\/plain)/.test(result.type)) window.open(result.url, "_blank", "noopener");
      else { const link = document.createElement("a"); link.href = result.url; link.download = result.name; document.body.append(link); link.click(); link.remove(); }
      setTimeout(() => URL.revokeObjectURL(result.url), 60000);
    } catch (reason) { setFileError(reason instanceof Error ? reason.message : "Não foi possível abrir o anexo."); }
    finally { setBusyFile(""); }
  };
  const print = () => {
    if (!full) return;
    const popup = window.open("", "_blank");
    if (!popup) return;
    const header = `<div style="font:13px Arial;color:#444;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:14px"><h2 style="font:600 18px Arial;margin:0 0 8px">${escapeHtml(full.subject || "(Sem assunto)")}</h2><div><b>De:</b> ${escapeHtml(name)} &lt;${escapeHtml(sender)}&gt;</div><div><b>Data:</b> ${escapeHtml(fullDate(messageDate(message)))}</div><div><b>Para:</b> ${escapeHtml((full.toRecipients ?? []).map(personName).join("; "))}</div>${full.ccRecipients?.length ? `<div><b>Cc:</b> ${escapeHtml(full.ccRecipients.map(personName).join("; "))}</div>` : ""}</div>`;
    popup.document.write(safeEmailDocument(full.body?.content || "", full.body?.contentType || "text", true).replace("<body>", "<body>" + header));
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 400);
  };
  if (!expanded) return <article className={"ol-msg collapsed" + (message.deleted ? " deleted" : "")}>
    <button className="ol-msg-collapsed" onClick={onToggle}>
      <span className="ol-avatar small" style={{ background: avatarColor(name) }}>{initials(name)}</span>
      <span className={"ol-msg-who" + (!message.isRead ? " unread" : "")}>{message.isDraft ? <em className="ol-draft-tag">[Rascunho] </em> : null}{name}</span>
      <span className="ol-msg-snippet">{message.bodyPreview}</span>
      <time>{fullDate(messageDate(message))}</time>
    </button>
  </article>;
  return <article className={"ol-msg" + (message.deleted ? " deleted" : "")}>
    <header className="ol-msg-head">
      <span className="ol-avatar" style={{ background: avatarColor(name) }}>{initials(name)}</span>
      <div className="ol-msg-meta" onClick={onToggle}>
        <div className="ol-msg-from"><strong>{name}</strong>{sender && <span>&lt;{sender}&gt;</span>}</div>
        <div className="ol-msg-to">Para: {(full?.toRecipients ?? message.toRecipients ?? []).map(personName).join("; ") || "—"}</div>
        {!!(full?.ccRecipients ?? message.ccRecipients)?.length && <div className="ol-msg-to">Cc: {(full?.ccRecipients ?? message.ccRecipients ?? []).map(personName).join("; ")}</div>}
        {!!full && !!(full as FullMail & { bccRecipients?: { emailAddress?: { address?: string } }[] }).bccRecipients?.length && <div className="ol-msg-to">Bcc: {((full as FullMail & { bccRecipients?: { emailAddress?: { address?: string } }[] }).bccRecipients ?? []).map(personName).join("; ")}</div>}
        <time>{fullDate(messageDate(message))}{message.importance === "high" && <span className="ol-important"> ! Importância alta</span>}{message.deleted && <span className="ol-deleted-tag"> · Em Itens Eliminados</span>}</time>
      </div>
      <div className="ol-msg-actions">
        {message.isDraft ? <button className="ol-btn" onClick={onEditDraft}><Icon name="compose" size={16}/> Continuar a editar</button> : <>
          <button className="ol-icon" title="Responder" aria-label="Responder" onClick={() => onReply("reply")}><Icon name="reply"/></button>
          <button className="ol-icon" title="Responder a todos" aria-label="Responder a todos" onClick={() => onReply("replyAll")}><Icon name="replyAll"/></button>
          <button className="ol-icon" title="Reencaminhar" aria-label="Reencaminhar" onClick={() => onReply("forward")}><Icon name="forward"/></button>
        </>}
        <span className="ol-menu-wrap"><button className="ol-icon" title="Mais ações" aria-label="Mais ações" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Icon name="more"/></button>
          {menu && <div className="ol-menu" role="menu" onMouseLeave={() => setMenu(false)}>
            <button role="menuitem" disabled={!full} onClick={() => { setMenu(false); print(); }}><Icon name="print" size={16}/> Imprimir</button>
            {hasRemote && <button role="menuitem" onClick={() => { setMenu(false); setImages(true); }}><Icon name="image" size={16}/> Mostrar imagens</button>}
          </div>}
        </span>
      </div>
    </header>
    {error && <p className="ol-inline-error" role="alert">{error} <button onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></p>}
    {!full && !error && <div className="ol-body-loading"><span className="ol-spinner"/> A abrir mensagem…</div>}
    {full && hasRemote && !images && <div className="ol-banner"><Icon name="image" size={16}/><span>Para proteger a sua privacidade, as imagens externas foram bloqueadas.</span><button onClick={() => setImages(true)}>Mostrar imagens</button>{sender && <button onClick={() => { const list = [...new Set([...readStore<string[]>(TRUSTED, []), sender])]; writeStore(TRUSTED, list); setTrusted(true); setImages(true); }}>Confiar sempre em {sender}</button>}</div>}
    {full && files.length > 0 && <ul className="ol-attachments" aria-label="Anexos">{files.map(file => { const [label, color] = fileIcon(file.name); return <li key={file.id} className="ol-attachment">
      <span className="ol-file-icon" style={{ background: color }}>{label}</span>
      <span className="ol-file-name" title={file.name}>{file.name}<small>{formatSize(file.size)}</small></span>
      <button className="ol-icon" disabled={Boolean(busyFile)} title="Pré-visualizar" aria-label={"Pré-visualizar " + file.name} onClick={() => void open(file, true)}><Icon name="eye" size={16}/></button>
      <button className="ol-icon" disabled={Boolean(busyFile)} title="Descarregar" aria-label={"Descarregar " + file.name} onClick={() => void open(file, false)}>{busyFile === file.id ? <span className="ol-spinner"/> : <Icon name="download" size={16}/>}</button>
    </li>; })}</ul>}
    {fileError && <p className="ol-inline-error" role="alert">{fileError}</p>}
    {full && <MailBody html={safeEmailDocument(full.body?.content || "", full.body?.contentType || "text", images || trusted)}/>}
    {full && !message.isDraft && <div className="ol-msg-foot"><button className="ol-btn" onClick={() => onReply("reply")}><Icon name="reply" size={16}/> Responder</button><button className="ol-btn" onClick={() => onReply("replyAll")}><Icon name="replyAll" size={16}/> Responder a todos</button><button className="ol-btn" onClick={() => onReply("forward")}><Icon name="forward" size={16}/> Reencaminhar</button></div>}
  </article>;
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function ReadingPane({ latest, items, folderKey, categories, onReply, onEditDraft, onMarkRead, onBack, onOpenEntity }: Props) {
  const [thread, setThread] = useState<Msg[]>(items);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([latest.id]));
  const [loading, setLoading] = useState(false);
  const markRead = useRef(onMarkRead); markRead.current = onMarkRead;
  const conversation = latest.conversationId;
  useEffect(() => {
    const unread = items.filter(item => !item.isRead && !item.isDraft).map(item => item.id);
    if (unread.length) markRead.current(unread);
    setThread(items); setExpanded(new Set([latest.id, ...unread]));
    if (!conversation) return;
    const controller = new AbortController(); setLoading(true);
    mailRequest("/api/mail/conversation?id=" + encodeURIComponent(conversation), { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        const list = (result.mensagens as Msg[]).filter(item => folderKey === "deleteditems" || !item.deleted || item.id === latest.id);
        if (list.length) setThread(list);
      })
      .catch(() => { /* the list's own copy stays visible */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // The open conversation is identified by its latest message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.id, conversation, folderKey]);
  const ordered = thread.length ? thread : items;
  const newest = ordered[ordered.length - 1];
  const tags = [...new Set(ordered.flatMap(item => item.categories ?? []))];
  return <section className="ol-reading" aria-label="Painel de leitura">
    <header className="ol-reading-head">
      <button className="ol-icon ol-only-mobile" onClick={onBack} aria-label="Voltar à lista"><Icon name="back"/></button>
      <div>
        <h2>{latest.subject || "(Sem assunto)"}</h2>
        <div className="ol-reading-tags">
          {ordered.length > 1 && <span className="ol-count-label">{ordered.length} mensagens</span>}
          {latest.entidade?.nome && <button className="ol-badge entity" onClick={() => onOpenEntity?.(latest)} disabled={!onOpenEntity} title="Abrir no CRM">{latest.entidade.tipo === "fabricante" ? "Fabricante" : "Cliente"} · {latest.entidade.nome}</button>}
          {latest.lead && <span className="ol-badge lead">Lead · remetente fora do CRM</span>}
          {tags.map(tag => <span key={tag} className="ol-category" style={{ "--cat": categoryColor(categories, tag) } as React.CSSProperties}>{tag}</span>)}
          {loading && <span className="ol-spinner" aria-label="A carregar conversa"/>}
        </div>
      </div>
    </header>
    <div className="ol-thread">
      {ordered.map(message => <MessageCard key={message.id} message={message} expanded={expanded.has(message.id) || message.id === newest?.id && expanded.size === 0}
        onToggle={() => setExpanded(previous => { const next = new Set(previous); if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; })}
        onReply={mode => onReply(mode, message)} onEditDraft={() => onEditDraft(message)}/>)}
    </div>
  </section>;
}
