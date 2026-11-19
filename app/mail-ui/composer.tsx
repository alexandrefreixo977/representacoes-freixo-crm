"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileBase64, mailRequest } from "../mail-client";
import type { MailAttachment } from "../mail-content";
import { addRecipients, recipientFields, type RecipientField, type RecipientLists } from "../mail-recipients";
import MailRecipientField from "../mail-recipient-field";
import { htmlToText, sanitizeComposeHtml } from "../mail-html";
import { askConfirm } from "../ui-feedback";
import Icon from "./icons";
import { safeEmailDocument } from "./reading-pane";
import { formatSize, postJson, type ComposeState } from "./shared";

export type SentInfo = { mode: ComposeState["mode"]; to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; text: string; attachments: string[] };
type Props = { state: ComposeState; contacts: { email: string; name: string }[]; onClose: (outcome: "sent" | "discarded" | "kept", info?: SentInfo) => void; onBack?: () => void };

const FONTS = ["Calibri", "Arial", "Segoe UI", "Georgia", "Times New Roman", "Verdana", "Courier New"];
const SIZES: [string, string][] = [["2", "Pequeno"], ["3", "Normal"], ["4", "Grande"], ["5", "Muito grande"]];
const TITLES = { new: "Nova mensagem", reply: "Responder", replyAll: "Responder a todos", forward: "Reencaminhar" };
const MAX_FILE = 20 * 1024 * 1024;

export default function Composer({ state, contacts, onClose, onBack }: Props) {
  const editor = useRef<HTMLDivElement | null>(null);
  const [recipients, setRecipients] = useState<RecipientLists>({ to: state.to ?? [], cc: [], bcc: [] });
  const [drafts, setDrafts] = useState({ to: "", cc: "", bcc: "" });
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [importance, setImportance] = useState<"normal" | "high">("normal");
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [uploading, setUploading] = useState<string[]>([]);
  const [quote, setQuote] = useState("");
  const [showQuote, setShowQuote] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [dirty, setDirty] = useState(0);
  const draftId = useRef<string | undefined>(state.draftId);
  const saving = useRef<Promise<string | undefined> | null>(null);
  const quoteRef = useRef("");
  const closed = useRef(false);
  const selection = useRef<Range | null>(null);
  const files = useRef<HTMLInputElement | null>(null);

  const setHtml = (html: string) => { if (editor.current) editor.current.innerHTML = html; };

  const focusEditor = () => {
    const node = editor.current; if (!node) return;
    node.focus();
    const range = document.createRange(); range.setStart(node, 0); range.collapse(true);
    const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(range);
  };

  // Opening: load signature and, for replies, let Outlook build the reply (recipients, subject and quote).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (state.draftId) {
          const draft = await mailRequest("/api/mail/draft?id=" + encodeURIComponent(state.draftId));
          if (!active) return;
          setRecipients({ to: draft.to, cc: draft.cc, bcc: draft.bcc }); setShowCc(draft.cc.length > 0); setShowBcc(draft.bcc.length > 0);
          setSubject(draft.subject); setImportance(draft.importance === "high" ? "high" : "normal"); setAttachments(draft.attachments);
          quoteRef.current = draft.quoteHtml; setQuote(draft.quoteHtml); setHtml(draft.html || "<div><br></div>");
        } else {
          const context = await mailRequest("/api/mail/compose-context?signatureOnly=1").catch(() => null);
          if (!active) return;
          const signature = context?.signature?.enabled && context.signature.html ? `<div><br></div><div class="rf-signature">${sanitizeComposeHtml(context.signature.html)}</div>` : "";
          const initial = `<div><br></div>${signature}`;
          setHtml(initial);
          if (state.mode !== "new" && state.source) {
            setStatus("A preparar a resposta no Outlook…");
            const result = await postJson("/api/mail/draft", { mode: state.mode, sourceId: state.source.id, html: initial });
            if (!active) return;
            draftId.current = result.id; quoteRef.current = result.quoteHtml || ""; setQuote(result.quoteHtml || "");
            setSubject(result.subject ?? ""); setRecipients({ to: result.to ?? [], cc: result.cc ?? [], bcc: [] }); setShowCc((result.cc ?? []).length > 0);
            if (state.mode === "forward") {
              const draft = await mailRequest("/api/mail/draft?id=" + encodeURIComponent(result.id)).catch(() => null);
              if (active && draft) setAttachments(draft.attachments);
            }
            setStatus("Rascunho guardado");
          }
        }
        if (active) { setReady(true); setTimeout(() => { if (state.mode === "new" && !state.to?.length && !state.draftId) document.getElementById("ol-compose-to")?.querySelector("input")?.focus(); else focusEditor(); }, 30); }
      } catch (reason) { if (active) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir o editor."); setReady(true); } }
    })();
    return () => { active = false; };
    // Each compose session is keyed by state.key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.key]);

  const collect = useCallback(() => {
    let selected = recipients;
    for (const field of recipientFields) {
      if (!drafts[field].trim()) continue;
      const result = addRecipients(selected, field, drafts[field]);
      if (result.error.startsWith("Endereço")) throw new Error(result.error);
      selected = result.recipients;
    }
    return selected;
  }, [recipients, drafts]);

  const save = useCallback(async (send = false): Promise<string | undefined> => {
    if (saving.current) await saving.current.catch(() => undefined);
    const html = editor.current?.innerHTML ?? "";
    const lists = send ? collect() : recipients;
    const run = (async () => {
      const result = await postJson("/api/mail/draft", { id: draftId.current, mode: state.mode, sourceId: state.source?.id, subject, ...lists, html, quoteHtml: quoteRef.current, importance, send, allowEmptySubject: true });
      if (result.id) draftId.current = result.id;
      if (!send && typeof result.quoteHtml === "string") quoteRef.current = result.quoteHtml;
      return result.id as string | undefined;
    })();
    saving.current = run;
    try { return await run; } finally { if (saving.current === run) saving.current = null; }
  }, [collect, recipients, subject, importance, state.mode, state.source?.id]);

  // Autosave a few seconds after the last change, like Outlook.
  useEffect(() => {
    if (!dirty || !ready || sending) return;
    const timer = setTimeout(async () => {
      if (closed.current) return;
      setStatus("A guardar…");
      try { await save(false); if (!closed.current) setStatus("Rascunho guardado às " + new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })); }
      catch (reason) { if (!closed.current) setStatus(reason instanceof Error ? "Não guardado: " + reason.message : "Não foi possível guardar o rascunho."); }
    }, 3500);
    return () => clearTimeout(timer);
  }, [dirty, ready, sending, save]);
  const touch = () => setDirty(value => value + 1);

  const send = async () => {
    if (sending) return;
    setError("");
    let lists: RecipientLists;
    try { lists = collect(); } catch (reason) { setError((reason as Error).message); return; }
    if (!lists.to.length && !lists.cc.length && !lists.bcc.length) { setError("Adicione pelo menos um destinatário."); return; }
    if (!lists.to.length) { setError("Adicione pelo menos um destinatário em Para."); return; }
    if (uploading.length) { setError("Aguarde que os anexos terminem de carregar."); return; }
    const html = editor.current?.innerHTML ?? "";
    const text = htmlToText(html);
    if (!subject.trim() && !(await askConfirm({ title: "Enviar sem assunto?", message: "Esta mensagem não tem assunto.", confirmLabel: "Enviar" }))) return;
    if (/\banex(o|os|ado|ados|ei)\b|\bem anexo\b|\battach(ed|ment)\b|\badjunt/i.test(text.replace(/\n--[\s\S]*$/, "")) && !attachments.length && !(await askConfirm({ title: "Esqueceu-se do anexo?", message: "O texto refere um anexo, mas a mensagem não tem nenhum ficheiro anexado.", confirmLabel: "Enviar assim" }))) return;
    setSending(true); setStatus("A enviar…");
    try {
      setRecipients(lists); setDrafts({ to: "", cc: "", bcc: "" });
      await save(true);
      closed.current = true;
      onClose("sent", { mode: state.mode, ...lists, subject, html, text, attachments: attachments.map(file => file.name) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar. Consulte os Itens Enviados antes de tentar novamente."); setStatus(""); }
    finally { setSending(false); }
  };

  const discard = async () => {
    const hasContent = draftId.current || htmlToText(editor.current?.innerHTML ?? "").length > 0 || subject;
    if (hasContent && !(await askConfirm({ title: "Descartar mensagem?", message: "O rascunho será movido para Itens Eliminados.", confirmLabel: "Descartar", danger: true }))) return;
    closed.current = true;
    if (saving.current) await saving.current.catch(() => undefined);
    if (draftId.current) await mailRequest("/api/mail/draft?id=" + encodeURIComponent(draftId.current), { method: "DELETE" }).catch(() => undefined);
    onClose("discarded");
  };

  const keep = async () => {
    closed.current = true;
    const hasContent = htmlToText(editor.current?.innerHTML ?? "").length > 0 || subject || recipients.to.length;
    if (hasContent && dirty) { try { await save(false); } catch { /* the draft that exists stays in Rascunhos */ } }
    onClose("kept");
  };

  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    const tooBig = list.find(file => file.size > MAX_FILE);
    if (tooBig) { setError(`${tooBig.name} ultrapassa 20 MB. Partilhe-o por link.`); list = list.filter(file => file.size <= MAX_FILE); }
    setUploading(previous => [...previous, ...list.map(file => file.name)]);
    try {
      const id = draftId.current ?? await save(false);
      if (!id) throw new Error("Não foi possível criar o rascunho para anexar.");
      for (const file of list) {
        const result = await postJson("/api/mail/draft-attachment", { draftId: id, name: file.name, contentType: file.type || "application/octet-stream", contentBytes: await fileBase64(file) });
        setAttachments(result.attachments);
        setUploading(previous => { const next = [...previous]; next.splice(next.indexOf(file.name), 1); return next; });
      }
      setStatus("Rascunho guardado às " + new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível anexar o ficheiro."); setUploading([]); }
  };
  const removeFile = async (file: MailAttachment) => {
    if (!draftId.current) return;
    try { const result = await mailRequest("/api/mail/draft-attachment?" + new URLSearchParams({ draftId: draftId.current, attachmentId: file.id }), { method: "DELETE" }); setAttachments(result.attachments); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível remover o anexo."); }
  };

  const command = (name: string, value?: string) => {
    editor.current?.focus();
    if (selection.current) { const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(selection.current); }
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
    touch();
  };
  const remember = () => { const selected = window.getSelection(); if (selected?.rangeCount && editor.current?.contains(selected.anchorNode)) selection.current = selected.getRangeAt(0).cloneRange(); };
  const tool = (icon: string, label: string, run: () => void) => <button type="button" className="ol-tool" title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={run}><Icon name={icon} size={16}/></button>;

  return <section className="ol-compose" aria-label={TITLES[state.mode]} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}>
    <header className="ol-compose-head">
      {onBack && <button className="ol-icon ol-only-mobile" onClick={() => void keep()} aria-label="Voltar"><Icon name="back"/></button>}
      <h2>{TITLES[state.mode]}</h2>
      <span className="ol-compose-status" role="status">{status}</span>
      <button className="ol-icon" title="Fechar (guarda nos Rascunhos)" aria-label="Fechar e guardar nos Rascunhos" onClick={() => void keep()}><Icon name="close"/></button>
    </header>
    <div className="ol-compose-actions">
      <button className="ol-send" disabled={sending || !ready} onClick={() => void send()} title="Enviar (Ctrl+Enter)"><Icon name="sentitems" size={16}/> {sending ? "A enviar…" : "Enviar"}</button>
      <button className="ol-btn" disabled={sending} onClick={() => void discard()}>Descartar</button>
      <button className="ol-btn" disabled={sending || !ready} onClick={() => files.current?.click()}><Icon name="paperclip" size={16}/> Anexar</button>
      <button className={"ol-btn" + (importance === "high" ? " on" : "")} aria-pressed={importance === "high"} onClick={() => { setImportance(value => value === "high" ? "normal" : "high"); touch(); }} title="Importância alta"><span className="ol-important">!</span> Importante</button>
      <input ref={files} type="file" multiple hidden onChange={event => { const list = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void addFiles(list); }}/>
    </div>
    {error && <p className="ol-inline-error" role="alert">{error}</p>}
    <fieldset className="ol-compose-fields" disabled={sending || !ready}>
      <div id="ol-compose-to" className="ol-recipient-row">
        <MailRecipientField label="Para" values={recipients.to} draft={drafts.to} contacts={contacts} onDraft={value => setDrafts(previous => ({ ...previous, to: value }))} onCommit={value => commit("to", value)} onRemove={address => remove("to", address)}/>
        <span className="ol-cc-toggles">{!showCc && <button type="button" onClick={() => setShowCc(true)}>Cc</button>}{!showBcc && <button type="button" onClick={() => setShowBcc(true)}>Bcc</button>}</span>
      </div>
      {showCc && <MailRecipientField label="Cc" values={recipients.cc} draft={drafts.cc} contacts={contacts} onDraft={value => setDrafts(previous => ({ ...previous, cc: value }))} onCommit={value => commit("cc", value)} onRemove={address => remove("cc", address)}/>}
      {showBcc && <MailRecipientField label="Bcc" values={recipients.bcc} draft={drafts.bcc} contacts={contacts} onDraft={value => setDrafts(previous => ({ ...previous, bcc: value }))} onCommit={value => commit("bcc", value)} onRemove={address => remove("bcc", address)}/>}
      <input className="ol-subject-input" aria-label="Assunto" placeholder="Adicionar um assunto" value={subject} maxLength={900} onChange={event => { setSubject(event.target.value.replace(/[\r\n]/g, " ")); touch(); }}/>
    </fieldset>
    {(attachments.length > 0 || uploading.length > 0) && <ul className="ol-attachments compose">
      {attachments.map(file => <li key={file.id} className="ol-attachment"><Icon name="paperclip" size={15}/><span className="ol-file-name" title={file.name}>{file.name}<small>{formatSize(file.size)}</small></span><button className="ol-icon" disabled={sending} onClick={() => void removeFile(file)} aria-label={"Remover " + file.name} title="Remover"><Icon name="close" size={14}/></button></li>)}
      {uploading.map((name, index) => <li key={"u" + index} className="ol-attachment uploading"><span className="ol-spinner"/><span className="ol-file-name">{name}<small>A carregar…</small></span></li>)}
    </ul>}
    <div className="ol-toolbar" role="toolbar" aria-label="Formatação">
      <select aria-label="Tipo de letra" defaultValue="" onMouseDown={remember} onChange={event => { command("fontName", event.target.value); event.target.value = ""; }}><option value="" disabled>Tipo de letra</option>{FONTS.map(font => <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>)}</select>
      <select aria-label="Tamanho" defaultValue="" onMouseDown={remember} onChange={event => { command("fontSize", event.target.value); event.target.value = ""; }}><option value="" disabled>Tamanho</option>{SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span className="ol-tool-sep"/>
      {tool("bold", "Negrito (Ctrl+B)", () => command("bold"))}{tool("italic", "Itálico (Ctrl+I)", () => command("italic"))}{tool("underline", "Sublinhado (Ctrl+U)", () => command("underline"))}{tool("strike", "Rasurado", () => command("strikeThrough"))}
      <label className="ol-tool color" title="Cor do texto" onMouseDown={remember}><Icon name="textColor" size={16}/><input type="color" aria-label="Cor do texto" defaultValue="#c0392b" onChange={event => command("foreColor", event.target.value)}/></label>
      <label className="ol-tool color" title="Realce" onMouseDown={remember}><Icon name="highlight" size={16}/><input type="color" aria-label="Cor de realce" defaultValue="#fff2a8" onChange={event => command("hiliteColor", event.target.value)}/></label>
      <span className="ol-tool-sep"/>
      {tool("listBullet", "Marcas", () => command("insertUnorderedList"))}{tool("listNumber", "Numeração", () => command("insertOrderedList"))}{tool("outdent", "Diminuir avanço", () => command("outdent"))}{tool("indent", "Aumentar avanço", () => command("indent"))}
      {tool("alignLeft", "Alinhar à esquerda", () => command("justifyLeft"))}{tool("alignCenter", "Centrar", () => command("justifyCenter"))}{tool("alignRight", "Alinhar à direita", () => command("justifyRight"))}
      <span className="ol-tool-sep"/>
      {tool("link", "Inserir ligação", () => { remember(); setLink("https://"); })}{tool("quote", "Citação", () => command("formatBlock", "blockquote"))}{tool("eraser", "Limpar formatação", () => command("removeFormat"))}
      <span className="ol-tool-sep"/>
      {tool("undo", "Anular (Ctrl+Z)", () => command("undo"))}{tool("redo", "Refazer (Ctrl+Y)", () => command("redo"))}
    </div>
    {link !== null && <form className="ol-link-bar" onSubmit={event => { event.preventDefault(); if (/^(https?:\/\/|mailto:)/i.test(link)) command("createLink", link); setLink(null); }}><input autoFocus value={link} onChange={event => setLink(event.target.value)} aria-label="Endereço da ligação"/><button className="ol-btn" type="submit">Inserir</button><button className="ol-btn" type="button" onClick={() => { command("unlink"); setLink(null); }}>Remover ligação</button><button className="ol-btn" type="button" onClick={() => setLink(null)}>Cancelar</button></form>}
    <div className="ol-editor-wrap" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); } }}>
      <div ref={editor} className="ol-editor" contentEditable={ready && !sending} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Corpo da mensagem"
        onInput={touch} onKeyUp={remember} onMouseUp={remember}
        onPaste={event => {
          const html = event.clipboardData.getData("text/html");
          if (event.clipboardData.files.length) { event.preventDefault(); void addFiles(Array.from(event.clipboardData.files)); return; }
          if (!html) return;
          event.preventDefault();
          document.execCommand("insertHTML", false, sanitizeComposeHtml(html.replace(/^[\s\S]*<!--StartFragment-->|<!--EndFragment-->[\s\S]*$/g, "")));
          touch();
        }}/>
      {quote && <div className="ol-quote">
        <button className="ol-btn" onClick={() => setShowQuote(value => !value)} aria-expanded={showQuote}><Icon name="more" size={16}/> {showQuote ? "Ocultar mensagem original" : "Mostrar mensagem original"}</button>
        {showQuote && <iframe className="ol-body-frame quote" title="Mensagem original" sandbox="" srcDoc={safeEmailDocument(quote, "html", false)}/>}
      </div>}
    </div>
  </section>;

  function commit(field: RecipientField, value: string) {
    const result = addRecipients(recipients, field, value);
    setRecipients(result.recipients); setError(result.error);
    setDrafts(previous => ({ ...previous, [field]: result.error.startsWith("Endereço") ? value : "" }));
    touch();
  }
  function remove(field: RecipientField, address: string) { setRecipients(previous => ({ ...previous, [field]: previous[field].filter(item => item !== address) })); touch(); }
}
