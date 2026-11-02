"use client";
import { askConfirm } from "./ui-feedback";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { LiveMessage } from "./mail-matching";
import { mailRequest } from "./mail-client";
import MailReader from "./mail-reader";
import { MAX_REPLY_ATTACHMENTS } from "./mail-content";
import EmailComposer, { type ComposedEmail } from "./email-composer";
import { supabase } from "./supabase";
import { recordSentMail, sentClientId, type MailClient } from "./mail-sent";
const date = (m: LiveMessage) => (m.direction === "out" ? m.sentDateTime : m.receivedDateTime) || m.receivedDateTime || m.sentDateTime;
const formatDate = (value?: string) => value ? new Date(value).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "Sem data";
export default function Mailbox({ session, emails, clients = [] }: { session: Session | null; emails?: string[]; clients?: MailClient[] }) {
  const entityMode = emails !== undefined;
  const addresses = JSON.stringify([...new Set((emails ?? []).map(email => email.trim().toLowerCase()).filter(Boolean))].sort());
  const [folder, setFolder] = useState("inbox");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState(0);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [limited, setLimited] = useState(false);
  const [selected, setSelected] = useState<LiveMessage | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const removed = useRef(new Set<string>());
  const readIds = useRef(new Set<string>());
  const onRead = useCallback((id: string) => {
    readIds.current.add(id);
    setMessages(previous => previous.map(item => item.id === id ? { ...item, isRead: true } : item));
    setSelected(previous => previous?.id === id ? { ...previous, isRead: true } : previous);
  }, []);
  const deleteMessage = async (message: LiveMessage) => {
    if (deletingRef.current || !(await askConfirm({title:"Mover para o lixo?",confirmLabel:"Mover",danger:true}))) return;
    deletingRef.current = true; setDeleting(message.id); setError("");
    try {
      await mailRequest("/api/mail/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id }) });
      removed.current.add(message.id);
      setMessages(previous => previous.filter(item => item.id !== message.id));
      setNotice("Mensagem movida para Itens Eliminados.");
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível eliminar a mensagem."); }
    finally { deletingRef.current = false; setDeleting(null); }
  };
  const requestRef = useRef<AbortController | null>(null);
  const owner = session?.user.id;

  const load = useCallback(async (page?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError("");
    if (!page) { removed.current.clear(); readIds.current.clear(); setMessages([]); setNextPage(null); setLimited(false); }
    try {
      let url: string;
      if (entityMode) {
        const values: string[] = JSON.parse(addresses);
        if (!values.length) return;
        const params = new URLSearchParams(); values.forEach(address => params.append("email", address));
        url = "/api/mail/by-entity?" + params;
      } else {
        const params = new URLSearchParams({ folder, q }); if (page) params.set("page", page);
        url = "/api/mail/list?" + params;
      }
      const result = await mailRequest(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMessages(previous => [...new Map([...(page ? previous : []), ...result.mensagens.filter((m: LiveMessage) => !removed.current.has(m.id)).map((m: LiveMessage) => readIds.current.has(m.id) ? { ...m, isRead: true } : m)].map((m: LiveMessage) => [m.id, m])).values()]);
      setNextPage(result.nextPage); setLimited(Boolean(result.limited));
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível ler o correio."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [entityMode, addresses, folder, q]);
  useEffect(() => { if (owner) void load(); return () => requestRef.current?.abort(); }, [load, owner, revision]);
  const recordNewEmail = async (email: ComposedEmail) => {
    // Delivery already succeeded: a logging failure must never invite a resend.
    try {
      await recordSentMail(supabase, session!.user.id, email, sentClientId(clients, email.to));
      setNotice("Email enviado e registado.");
    } catch (error) { setNotice(`Email enviado. ${error instanceof Error ? error.message : "O registo no CRM ficou incompleto."} Não é necessário voltar a enviar.`); }
    setComposing(false); setRevision(value => value + 1);
  };
  if (!session) return <p>Inicie sessão para consultar o correio.</p>;
  return <div className="mailbox">
    <header className="mail-heading"><div><span>MICROSOFT 365 · AO VIVO</span>{entityMode ? <h3>Emails</h3> : <h1>Correio</h1>}<p>{entityMode ? "Correspondência recebida e enviada, diretamente do Outlook." : session.user.email}</p></div><div className="mail-heading-actions">{!entityMode && <button onClick={() => { setComposing(true); setNotice(""); }}>＋ Novo email</button>}<button className="primary" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? "A atualizar…" : "↻ Atualizar"}</button></div></header>
    {!entityMode && <div className="mail-connection"><strong>Conta Microsoft 365 ligada</strong><span>Ligação segura ativa</span></div>}
    {notice && <p className="email-notice" role="status">{notice}</p>}
    <section className="card mail-card" aria-busy={loading}>
      {!entityMode && <div className="mail-toolbar"><nav aria-label="Pastas de correio">{[["inbox", "Entrada"], ["sentitems", "Enviados"]].map(([value, label]) => <button key={value} aria-pressed={folder === value} className={folder === value ? "active" : ""} onClick={() => setFolder(value)}>{label}</button>)}</nav><form className="mail-search" onSubmit={event => { event.preventDefault(); setQ(draft.trim()); setRevision(value => value + 1); }}><label htmlFor="mail-search-input">Pesquisar no Outlook</label><div><input id="mail-search-input" type="search" maxLength={250} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Remetente, assunto ou texto…"/><button type="submit">Pesquisar</button></div></form></div>}
      {error && <p className="mail-empty" role="alert">{error}</p>}
      {limited && <p className="email-notice" role="status">A Microsoft devolve até 1.000 resultados por endereço nesta pesquisa. Para correspondência mais antiga, consulte o Outlook.</p>}
      {!messages.length && !error && <div className="mail-empty" role="status">{loading ? "A consultar o Outlook…" : entityMode && addresses === "[]" ? "Adicione um email ao cliente ou aos seus contactos para consultar a correspondência." : "Sem mensagens para mostrar."}</div>}
      <ul className="mail-list">{messages.map(message => { const party = message.direction === "in" ? message.from : message.toRecipients?.[0]; return <li key={message.id} className="mail-list-item"><button className={"mail-row " + (!message.isRead ? "unread" : "")} onClick={() => setSelected(message)} aria-label={(!message.isRead ? "Não lido: " : "") + (message.subject || "Sem assunto")}><div className="mail-row-top"><span className="mail-person">{entityMode && (message.direction === "in" ? "Recebido · " : "Enviado · ")}{party?.emailAddress?.name || party?.emailAddress?.address || "Sem endereço"}</span><time dateTime={date(message)}>{formatDate(date(message))}</time></div><div className="mail-subject">{!message.isRead && <span className="mail-unread-dot" aria-hidden="true"/>}{message.subject || "Sem assunto"}{message.lead && <span className="mail-lead">Lead</span>}</div><p>{message.bodyPreview}</p>{message.entidade.nome && <span className="mail-entity">{message.entidade.nome}</span>}</button>{!entityMode && <button className="mail-delete" disabled={deleting !== null} onClick={() => void deleteMessage(message)} aria-label={"Eliminar " + (message.subject || "Sem assunto")} title="Mover para o lixo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>}</li>; })}</ul>
      {nextPage && <footer className="mail-pagination"><span>{messages.length} mensagens</span><button disabled={loading} onClick={() => void load(nextPage)}>{loading ? "A carregar…" : "Carregar mais"}</button></footer>}
    </section>
    {selected && <MailReader key={selected.id} message={selected} ownEmail={session.user.email || ""} onClose={() => setSelected(null)} onRead={onRead} onSent={() => setRevision(value => value + 1)}/>}
    {composing && <dialog className="mail-reader-backdrop" ref={node => { if (node && !node.open) node.showModal(); }} onCancel={event => { event.preventDefault(); if (!composeBusy) setComposing(false); }} aria-labelledby="mail-new-title"><section className="mail-reader mail-new"><header><h2 id="mail-new-title">Novo email</h2><button disabled={composeBusy} onClick={() => setComposing(false)} aria-label="Fechar novo email">×</button></header><div className="mail-reader-scroll"><EmailComposer providerToken={null} userId={session.user.id} sendLabel="Enviar" attachmentLimit={MAX_REPLY_ATTACHMENTS} onBusy={setComposeBusy} onCancel={() => setComposing(false)} toOptions={clients.flatMap(client=>[{label:client.name,email:client.email},...(client.contacts??[]).map(contact=>({label:contact.name+" — "+client.name,email:contact.email}))])} onSent={recordNewEmail}/></div></section></dialog>}
  </div>;
}

