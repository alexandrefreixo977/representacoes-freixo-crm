"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { mailRequest } from "../mail-client";
import { recordSentMail, sentClientId, type MailClient } from "../mail-sent";
import type { ComposedEmail } from "../email-composer";
import { supabase } from "../supabase";
import { askConfirm } from "../ui-feedback";
import Icon from "./icons";
import FolderPane from "./folder-pane";
import MessageList, { type Row } from "./message-list";
import ReadingPane from "./reading-pane";
import Composer, { type SentInfo } from "./composer";
import { categoryColor, mailAction, messageDate, readStore, writeStore, isTyping, type Action, type Category, type ComposeState, type Folder, type MailFilter, type Msg } from "./shared";

type Props = { session: Session | null; clients?: MailClient[]; onOpenClient?: (id: string) => void; onOpenManufacturer?: (id: string) => void };
type Toast = { text: string; undo?: () => Promise<void>; error?: boolean };
type Menu = { x: number; y: number; rows: Row[] } | null;

const FAVOURITES = "rf-mail-favourites";
const CONVERSATIONS = "rf-mail-conversations";

export default function MailApp({ session, clients = [], onOpenClient, onOpenManufacturer }: Props) {
  const owner = session?.user.id;
  const account = session?.user.email ?? "";
  const [folders, setFolders] = useState<Folder[]>([]);
  const [children, setChildren] = useState<Record<string, Folder[]>>({});
  const [allFolders, setAllFolders] = useState<Folder[] | null>(null);
  const [folderKey, setFolderKey] = useState("inbox");
  const [filter, setFilter] = useState<MailFilter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"folder" | "all">("folder");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contacts, setContacts] = useState<{ email: string; name: string }[]>([]);
  const [favourites, setFavourites] = useState<string[]>(() => readStore(FAVOURITES, ["inbox", "sentitems", "drafts"]));
  const [conversations, setConversations] = useState<boolean>(() => readStore(CONVERSATIONS, true));
  const [drawer, setDrawer] = useState(false);
  const [mobileRead, setMobileRead] = useState(false);
  const [moveFor, setMoveFor] = useState<Row[] | null>(null);
  const [categoryFor, setCategoryFor] = useState<{ rows: Row[]; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [help, setHelp] = useState(false);
  const request = useRef<AbortController | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  const currentFolder = [...folders, ...Object.values(children).flat()].find(folder => folder.id === folderKey || folder.wellKnown === folderKey);
  const wellKnown = currentFolder?.wellKnown ?? (["inbox", "drafts", "sentitems", "deleteditems", "junkemail", "archive"].includes(folderKey) ? folderKey : "");
  const outgoing = wellKnown === "sentitems" || wellKnown === "drafts" || wellKnown === "outbox";
  const title = query ? (scope === "all" ? "Resultados em todas as pastas" : `Resultados em ${currentFolder?.displayName ?? "pasta"}`) : currentFolder?.displayName ?? "Caixa de Entrada";

  // ——— Data loading ———
  const loadFolders = useCallback(async () => {
    try { const result = await mailRequest("/api/mail/folders"); setFolders(result.folders); }
    catch (reason) { setError(previous => previous || (reason instanceof Error ? reason.message : "Não foi possível ler as pastas.")); }
  }, []);
  useEffect(() => {
    if (!owner) return;
    void loadFolders();
    mailRequest("/api/mail/categories").then(result => setCategories(result.categories)).catch(() => undefined);
    mailRequest("/api/mail/compose-context").then(result => setContacts(result.contacts ?? [])).catch(() => undefined);
  }, [owner, loadFolders]);

  const load = useCallback(async (page?: string) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ folder: folderKey, filter, q: query, scope });
      if (page) params.set("page", page);
      const result = await mailRequest("/api/mail/messages?" + params, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setMessages(previous => { const map = new Map((page ? previous : []).map(item => [item.id, item])); for (const item of result.mensagens as Msg[]) map.set(item.id, item); return [...map.values()]; });
      setNextPage(result.nextPage);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível ler o correio."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [folderKey, filter, query, scope]);
  useEffect(() => { if (!owner) return; setMessages([]); setNextPage(null); setSelected(new Set()); setActive(null); void load(); return () => request.current?.abort(); }, [owner, load, revision]);

  // New mail arrives without a manual refresh: poll counts and the first page every minute.
  useEffect(() => {
    if (!owner) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      void loadFolders();
      if (query || filter !== "all") return;
      try {
        const result = await mailRequest("/api/mail/messages?" + new URLSearchParams({ folder: folderKey, filter: "all", q: "", scope: "folder" }));
        const fresh = result.mensagens as Msg[];
        setMessages(previous => {
          const oldest = fresh.length ? Math.min(...fresh.map(item => Date.parse(messageDate(item)) || 0)) : 0;
          const ids = new Set(fresh.map(item => item.id));
          return [...fresh, ...previous.filter(item => !ids.has(item.id) && (Date.parse(messageDate(item)) || 0) < oldest)];
        });
      } catch { /* the next tick tries again */ }
    }, 60000);
    return () => clearInterval(timer);
  }, [owner, folderKey, query, filter, loadFolders]);

  // ——— Rows (conversation grouping, as Outlook's "Mostrar como conversas") ———
  const rows = useMemo<Row[]>(() => {
    const ordered = [...messages].sort((a, b) => (Date.parse(messageDate(b)) || 0) - (Date.parse(messageDate(a)) || 0));
    if (!conversations || wellKnown === "drafts") return ordered.map(message => ({ key: "m:" + message.id, latest: message, items: [message] }));
    const groups = new Map<string, Row>();
    for (const message of ordered) {
      const key = message.conversationId ? "c:" + message.conversationId : "m:" + message.id;
      const row = groups.get(key);
      if (row) row.items.push(message); else groups.set(key, { key, latest: message, items: [message] });
    }
    return [...groups.values()];
  }, [messages, conversations, wellKnown]);
  const activeRow = rows.find(row => row.key === active) ?? null;
  const targetRows = selected.size ? rows.filter(row => selected.has(row.key)) : activeRow ? [activeRow] : [];
  const targets = targetRows.flatMap(row => row.items);

  // ——— Local state helpers ———
  const patchLocal = (ids: string[], patch: (message: Msg) => Msg) => { const set = new Set(ids); setMessages(previous => previous.map(item => set.has(item.id) ? patch(item) : item)); };
  const adjustUnread = (delta: number) => setFolders(previous => previous.map(folder => folder.id === currentFolder?.id ? { ...folder, unreadItemCount: Math.max(0, (folder.unreadItemCount ?? 0) + delta) } : folder));
  const notify = (text: string, undo?: () => Promise<void>, failed = false) => setToast({ text, undo, error: failed });
  const fail = (reason: unknown) => { notify(reason instanceof Error ? reason.message : "A operação não foi concluída.", undefined, true); setRevision(value => value + 1); };

  const removeLocal = (ids: string[]) => {
    const set = new Set(ids);
    const index = rows.findIndex(row => row.key === active);
    const remaining = rows.filter(row => !row.items.every(item => set.has(item.id)));
    setMessages(previous => previous.filter(item => !set.has(item.id)));
    setSelected(new Set());
    if (active && !remaining.some(row => row.key === active)) {
      const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
      setActive(next && window.innerWidth > 900 ? next.key : null);
      if (!next || window.innerWidth <= 900) setMobileRead(false);
    }
  };

  const act = async (action: Action, list: Msg[], extra: Record<string, unknown> = {}) => {
    if (!list.length) return;
    const ids = list.map(item => item.id);
    try { const result = await mailAction(action, ids, extra); if (!result.ok) notify(`${result.failed.length} de ${ids.length} mensagens não foram alteradas no Outlook.`, undefined, true); return result; }
    catch (reason) { fail(reason); return null; }
  };

  const markRead = async (list: Msg[], read: boolean) => {
    const changed = list.filter(item => Boolean(item.isRead) !== read && !item.isDraft);
    if (!changed.length) return;
    patchLocal(changed.map(item => item.id), item => ({ ...item, isRead: read }));
    adjustUnread(read ? -changed.length : changed.length);
    await act(read ? "read" : "unread", changed);
  };
  const markReadIds = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setMessages(previous => {
      const changed = previous.filter(item => set.has(item.id) && !item.isRead);
      if (changed.length) { void mailAction("read", changed.map(item => item.id)).catch(() => undefined); setFolders(list => list.map(folder => folder.id === currentFolder?.id ? { ...folder, unreadItemCount: Math.max(0, (folder.unreadItemCount ?? 0) - changed.length) } : folder)); }
      return previous.map(item => set.has(item.id) ? { ...item, isRead: true } : item);
    });
  }, [currentFolder?.id]);

  const toggleFlag = async (list: Msg[]) => {
    const flagged = list.some(item => item.flag?.flagStatus === "flagged");
    patchLocal(list.map(item => item.id), item => ({ ...item, flag: { flagStatus: flagged ? "notFlagged" : "flagged" } }));
    await act(flagged ? "unflag" : "flag", list);
  };
  const completeFlag = async (list: Msg[]) => { patchLocal(list.map(item => item.id), item => ({ ...item, flag: { flagStatus: "complete" } })); await act("complete", list); };

  const moveTo = async (list: Msg[], destination: string, label: string) => {
    if (!list.length) return;
    const origins = new Map<string, string[]>();
    for (const item of list) if (item.parentFolderId) origins.set(item.parentFolderId, [...(origins.get(item.parentFolderId) ?? []), item.id]);
    const unread = list.filter(item => !item.isRead).length;
    removeLocal(list.map(item => item.id));
    if (unread) adjustUnread(-unread);
    const result = await act(destination === "deleteditems" ? "delete" : "move", list, destination === "deleteditems" ? {} : { destination });
    if (!result) return;
    void loadFolders();
    notify(`${list.length === 1 ? "1 mensagem" : list.length + " mensagens"} ${label.replace(/\(s\)/g, list.length === 1 ? "" : "s")}.`, origins.size ? async () => {
      for (const [folder, ids] of origins) await mailAction("move", ids, { destination: folder });
      notify("Ação anulada."); setRevision(value => value + 1); void loadFolders();
    } : undefined);
  };

  const remove = async (list: Msg[]) => {
    if (!list.length) return;
    if (wellKnown === "deleteditems" || wellKnown === "junkemail") {
      if (!(await askConfirm({ title: "Eliminar definitivamente?", message: `${list.length === 1 ? "A mensagem será eliminada" : list.length + " mensagens serão eliminadas"} de forma permanente. Não é possível anular.`, confirmLabel: "Eliminar", danger: true }))) return;
      removeLocal(list.map(item => item.id));
      if (await act("purge", list)) { notify("Eliminado definitivamente."); void loadFolders(); }
      return;
    }
    await moveTo(list, "deleteditems", "movida(s) para Itens Eliminados");
  };
  const archive = (list: Msg[]) => moveTo(list, "archive", "arquivada(s)");
  const junk = (list: Msg[]) => wellKnown === "junkemail" ? moveTo(list, "inbox", "movida(s) para a Caixa de Entrada") : moveTo(list, "junkemail", "movida(s) para Lixo Eletrónico");

  const toggleCategory = async (list: Msg[], name: string) => {
    const all = list.every(item => item.categories?.includes(name));
    const next = Object.fromEntries(list.map(item => [item.id, all ? (item.categories ?? []).filter(value => value !== name) : [...new Set([...(item.categories ?? []), name])]]));
    patchLocal(list.map(item => item.id), item => ({ ...item, categories: next[item.id] }));
    await act("categorize", list, { categories: next });
  };
  const clearCategories = async (list: Msg[]) => {
    const next = Object.fromEntries(list.map(item => [item.id, [] as string[]]));
    patchLocal(list.map(item => item.id), item => ({ ...item, categories: [] }));
    await act("categorize", list, { categories: next });
  };

  // ——— Opening, selection and compose ———
  const openRow = (row: Row, event?: React.MouseEvent | React.KeyboardEvent) => {
    if (event && (event.ctrlKey || event.metaKey)) { toggleRow(row); return; }
    if (event && event.shiftKey && anchor) {
      const from = rows.findIndex(item => item.key === anchor), to = rows.findIndex(item => item.key === row.key);
      if (from >= 0 && to >= 0) { setSelected(new Set(rows.slice(Math.min(from, to), Math.max(from, to) + 1).map(item => item.key))); return; }
    }
    setSelected(new Set()); setAnchor(row.key);
    if (row.latest.isDraft && wellKnown === "drafts") { setCompose({ key: Date.now(), mode: "new", draftId: row.latest.id }); setActive(row.key); setMobileRead(true); return; }
    setCompose(null); setActive(row.key); setMobileRead(true);
  };
  const toggleRow = (row: Row) => { setAnchor(row.key); setSelected(previous => { const next = new Set(previous); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next; }); };
  const startCompose = (state: Omit<ComposeState, "key">) => { setCompose({ ...state, key: Date.now() }); setMobileRead(true); setDrawer(false); };
  const reply = (mode: "reply" | "replyAll" | "forward", message?: Msg) => { const source = message ?? activeRow?.latest; if (source) startCompose({ mode, source }); };

  const onComposeClose = async (outcome: "sent" | "discarded" | "kept", info?: SentInfo) => {
    const wasDraft = compose?.draftId;
    setCompose(null);
    if (!activeRow || wasDraft) setMobileRead(false);
    if (outcome === "sent" && info) {
      notify("Mensagem enviada.");
      if (info.mode === "new" && owner) {
        // New messages are logged in the CRM history, as before; replies stay in Outlook only.
        const email: ComposedEmail = { to: info.to[0], cc: info.cc, bcc: info.bcc, subject: info.subject, bodyText: info.text, bodyHtml: info.html, attachments: info.attachments.map(name => ({ name }) as File) };
        try { await recordSentMail(supabase, owner, email, sentClientId(clients, info.to[0])); }
        catch (reason) { notify(`Mensagem enviada. ${reason instanceof Error ? reason.message : "O registo no CRM ficou incompleto."} Não é necessário voltar a enviar.`, undefined, true); }
      }
    } else if (outcome === "discarded") notify("Rascunho descartado.");
    else if (outcome === "kept") notify("Guardado em Rascunhos.");
    if (outcome !== "kept" || wellKnown === "drafts") setRevision(value => value + 1);
    void loadFolders();
  };

  const openFolder = (folder: Folder) => {
    setFolderKey(folder.wellKnown ?? folder.id); setQuery(""); setSearch(""); setFilter("all"); setDrawer(false); setMobileRead(false); setCompose(null);
  };
  const expandFolder = async (folder: Folder) => {
    try { const result = await mailRequest("/api/mail/folders?parent=" + encodeURIComponent(folder.id)); setChildren(previous => ({ ...previous, [folder.id]: result.folders })); }
    catch (reason) { fail(reason); }
  };
  const toggleFavourite = (folder: Folder) => {
    const key = folder.wellKnown ?? folder.id;
    setFavourites(previous => { const next = previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]; writeStore(FAVOURITES, next); return next; });
  };
  const dropOn = (folder: Folder, ids: string[]) => {
    const list = messages.filter(item => ids.includes(item.id));
    if (folder.id === currentFolder?.id) return;
    void moveTo(list, folder.wellKnown ?? folder.id, `movida(s) para ${folder.displayName}`);
  };

  const quick = (row: Row, action: "delete" | "archive" | "flag" | "read") => {
    if (action === "delete") void remove(row.items);
    else if (action === "archive") void archive(row.items);
    else if (action === "flag") void toggleFlag(row.items);
    else void markRead(row.items, row.items.some(item => !item.isRead));
  };

  // ——— Keyboard shortcuts (Outlook / Gmail style) ———
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (isTyping(event.target) || event.altKey || help && event.key !== "Escape") return;
    const ctrl = event.ctrlKey || event.metaKey;
    const index = rows.findIndex(row => row.key === active);
    const move = (step: number) => { const next = rows[Math.min(Math.max(index + step, 0), rows.length - 1)]; if (next) openRow(next); };
    const handled = (run: () => void) => { event.preventDefault(); run(); };
    if (event.key === "Escape") { if (help) setHelp(false); else if (menu || categoryFor || moveFor) { setMenu(null); setCategoryFor(null); setMoveFor(null); } else if (selected.size) setSelected(new Set()); return; }
    if (ctrl && event.key.toLowerCase() === "n" || !ctrl && event.key === "n") return handled(() => startCompose({ mode: "new" }));
    if (ctrl) {
      if (event.key.toLowerCase() === "r" && event.shiftKey) return handled(() => reply("replyAll"));
      if (event.key.toLowerCase() === "r") return handled(() => reply("reply"));
      if (event.key.toLowerCase() === "f") return handled(() => reply("forward"));
      if (event.key.toLowerCase() === "q") return handled(() => void markRead(targets, true));
      if (event.key.toLowerCase() === "u") return handled(() => void markRead(targets, false));
      return;
    }
    switch (event.key) {
      case "j": case "ArrowDown": return handled(() => move(1));
      case "k": case "ArrowUp": return handled(() => move(-1));
      case "r": return handled(() => reply("reply"));
      case "a": case "R": return handled(() => reply("replyAll"));
      case "f": return handled(() => reply("forward"));
      case "e": return handled(() => void archive(targets));
      case "Delete": case "#": return handled(() => void remove(targets));
      case "s": case "Insert": return handled(() => void toggleFlag(targets));
      case "u": return handled(() => void markRead(targets, targets.some(item => !item.isRead)));
      case "v": return handled(() => targetRows.length && setMoveFor(targetRows));
      case "/": return handled(() => searchInput.current?.focus());
      case "?": return handled(() => setHelp(true));
    }
  };
  useEffect(() => { const listener = (event: KeyboardEvent) => keys.current(event); window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, []);
  useEffect(() => { if (!toast || toast.error) return; const timer = setTimeout(() => setToast(null), toast.undo ? 9000 : 4500); return () => clearTimeout(timer); }, [toast]);

  if (!session) return <p>Inicie sessão para consultar o correio.</p>;
  const has = targets.length > 0;
  const anyUnread = targets.some(item => !item.isRead);
  const anyFlagged = targets.some(item => item.flag?.flagStatus === "flagged");
  const single = targetRows.length === 1 ? targetRows[0].latest : null;

  return <div className={"ol-app" + (mobileRead ? " show-read" : "") + (drawer ? " show-folders" : "")}>
    <div className="ol-topbar">
      <button className="ol-icon ol-only-mobile" onClick={() => setDrawer(true)} aria-label="Pastas"><Icon name="menu"/></button>
      <form className="ol-search" role="search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setMobileRead(false); }}>
        <Icon name="search" size={17}/>
        <input ref={searchInput} type="search" value={search} maxLength={250} onChange={event => { setSearch(event.target.value); if (!event.target.value) setQuery(""); }} placeholder="Pesquisar correio (remetente, assunto, texto…)" aria-label="Pesquisar correio"/>
        <select value={scope} onChange={event => setScope(event.target.value as "folder" | "all")} aria-label="Onde pesquisar"><option value="folder">Nesta pasta</option><option value="all">Todas as pastas</option></select>
        {query && <button type="button" className="ol-icon" aria-label="Limpar pesquisa" onClick={() => { setSearch(""); setQuery(""); }}><Icon name="close" size={16}/></button>}
      </form>
      <button className="ol-icon" title="Atualizar" aria-label="Atualizar" disabled={loading} onClick={() => { setRevision(value => value + 1); void loadFolders(); }}><Icon name="refresh" className={loading ? "ol-spin" : ""}/></button>
      <button className="ol-icon ol-hide-mobile" title="Atalhos de teclado (?)" aria-label="Atalhos de teclado" onClick={() => setHelp(true)}><Icon name="keyboard"/></button>
    </div>

    <div className="ol-commandbar" role="toolbar" aria-label="Ações">
      <button className="ol-cmd primary" onClick={() => startCompose({ mode: "new" })}><Icon name="compose" size={17}/><span>Novo email</span></button>
      <span className="ol-cmd-sep"/>
      <button className="ol-cmd" disabled={!has} onClick={() => void remove(targets)} title="Eliminar (Delete)"><Icon name="trash" size={17}/><span>Eliminar</span></button>
      <button className="ol-cmd" disabled={!has || wellKnown === "archive"} onClick={() => void archive(targets)} title="Arquivar (E)"><Icon name="archive" size={17}/><span>Arquivar</span></button>
      <button className="ol-cmd" disabled={!has} onClick={() => void junk(targets)} title={wellKnown === "junkemail" ? "Não é lixo" : "Lixo eletrónico"}><Icon name="junkemail" size={17}/><span>{wellKnown === "junkemail" ? "Não é lixo" : "Lixo"}</span></button>
      <button className="ol-cmd" disabled={!has} onClick={() => setMoveFor(targetRows)} title="Mover para (V)"><Icon name="move" size={17}/><span>Mover para</span></button>
      <span className="ol-cmd-sep"/>
      <button className="ol-cmd" disabled={!single || single.isDraft} onClick={() => reply("reply", single ?? undefined)} title="Responder (R)"><Icon name="reply" size={17}/><span>Responder</span></button>
      <button className="ol-cmd" disabled={!single || single.isDraft} onClick={() => reply("replyAll", single ?? undefined)} title="Responder a todos (A)"><Icon name="replyAll" size={17}/><span>Responder a todos</span></button>
      <button className="ol-cmd" disabled={!single || single.isDraft} onClick={() => reply("forward", single ?? undefined)} title="Reencaminhar (F)"><Icon name="forward" size={17}/><span>Reencaminhar</span></button>
      <span className="ol-cmd-sep"/>
      <button className="ol-cmd" disabled={!has} onClick={() => void markRead(targets, anyUnread)} title={anyUnread ? "Marcar como lida (Ctrl+Q)" : "Marcar como não lida (Ctrl+U)"}><Icon name={anyUnread ? "mailOpen" : "mail"} size={17}/><span>{anyUnread ? "Lida" : "Não lida"}</span></button>
      <button className="ol-cmd" disabled={!has} onClick={event => setCategoryFor({ rows: targetRows, x: event.currentTarget.getBoundingClientRect().left, y: event.currentTarget.getBoundingClientRect().bottom + 4 })} title="Categorizar"><Icon name="tag" size={17}/><span>Categorizar</span></button>
      <button className="ol-cmd" disabled={!has} onClick={() => void toggleFlag(targets)} title="Sinalizar (S)"><Icon name="flag" size={17} filled={anyFlagged}/><span>Sinalizar</span></button>
      {anyFlagged && <button className="ol-cmd" onClick={() => void completeFlag(targets)} title="Marcar como concluído"><Icon name="check" size={17}/><span>Concluído</span></button>}
      {toast?.undo && <><span className="ol-cmd-sep"/><button className="ol-cmd" onClick={() => { const undo = toast.undo; setToast(null); void undo?.().catch(fail); }} title="Anular"><Icon name="undo" size={17}/><span>Anular</span></button></>}
    </div>

    <div className="ol-body">
      <div className="ol-folder-shade" onClick={() => setDrawer(false)} aria-hidden="true"/>
      <FolderPane folders={folders} subfolders={children} current={folderKey} favourites={favourites} account={account} onOpen={openFolder} onExpand={expandFolder} onToggleFavourite={toggleFavourite} onDropMessages={dropOn} onCompose={() => startCompose({ mode: "new" })}/>
      <MessageList title={title} rows={rows} selected={selected} active={active} loading={loading} error={error} hasMore={Boolean(nextPage)} filter={filter} searching={Boolean(query)} outgoing={outgoing} categories={categories} conversations={conversations && wellKnown !== "drafts"}
        onFilter={setFilter} onOpen={openRow} onToggle={toggleRow} onSelectAll={all => setSelected(all ? new Set(rows.map(row => row.key)) : new Set())}
        onMore={() => { if (nextPage && !loading) void load(nextPage); }} onQuick={quick} onContext={(row, x, y) => { if (!selected.has(row.key)) { setSelected(new Set()); setActive(row.key); } setMenu({ x, y, rows: selected.has(row.key) ? rows.filter(item => selected.has(item.key)) : [row] }); }}
        onToggleConversations={() => setConversations(value => { writeStore(CONVERSATIONS, !value); return !value; })} onRetry={() => setRevision(value => value + 1)}/>
      <div className="ol-right">
        {compose ? <Composer key={compose.key} state={compose} contacts={[...contacts, ...clients.flatMap(client => [{ email: client.email, name: client.name }, ...(client.contacts ?? []).map(contact => ({ email: contact.email, name: `${contact.name} — ${client.name}` }))]).filter(item => item.email)]} onClose={(outcome, info) => void onComposeClose(outcome, info)} onBack={() => setMobileRead(false)}/>
          : selected.size > 1 ? <div className="ol-placeholder"><Icon name="mail" size={54}/><strong>{selected.size} conversas selecionadas</strong><span>Use a barra de cima para eliminar, arquivar, mover, marcar ou categorizar todas de uma vez.</span><button className="ol-btn" onClick={() => setSelected(new Set())}>Limpar seleção</button></div>
          : activeRow ? <ReadingPane key={activeRow.key} latest={activeRow.latest} items={activeRow.items} folderKey={wellKnown || folderKey} categories={categories} onReply={(mode, message) => reply(mode, message)} onEditDraft={message => startCompose({ mode: "new", draftId: message.id })} onMarkRead={markReadIds} onBack={() => { setMobileRead(false); setActive(null); }}
              onOpenEntity={(onOpenClient || onOpenManufacturer) ? message => { if (message.entidade.tipo === "cliente" && message.entidade.id) onOpenClient?.(message.entidade.id); if (message.entidade.tipo === "fabricante" && message.entidade.id) onOpenManufacturer?.(message.entidade.id); } : undefined}/>
          : <div className="ol-placeholder"><Icon name="mailOpen" size={54}/><strong>Selecione um item para ler</strong><span>Nada está selecionado.</span></div>}
      </div>
    </div>
    <button className="ol-fab ol-only-mobile" onClick={() => startCompose({ mode: "new" })} aria-label="Novo email"><Icon name="compose" size={22}/></button>

    {menu && <div className="ol-overlay" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }}>
      <div className="ol-menu context" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 380) }} onClick={event => event.stopPropagation()}>
        {(() => { const list = menu.rows.flatMap(row => row.items); const one = menu.rows.length === 1 ? menu.rows[0].latest : null; const close = (run: () => void) => () => { setMenu(null); run(); }; return <>
          {one && !one.isDraft && <><button role="menuitem" onClick={close(() => reply("reply", one))}><Icon name="reply" size={16}/> Responder</button><button role="menuitem" onClick={close(() => reply("replyAll", one))}><Icon name="replyAll" size={16}/> Responder a todos</button><button role="menuitem" onClick={close(() => reply("forward", one))}><Icon name="forward" size={16}/> Reencaminhar</button><hr/></>}
          <button role="menuitem" onClick={close(() => void remove(list))}><Icon name="trash" size={16}/> Eliminar</button>
          <button role="menuitem" onClick={close(() => void archive(list))}><Icon name="archive" size={16}/> Arquivar</button>
          <button role="menuitem" onClick={close(() => setMoveFor(menu.rows))}><Icon name="move" size={16}/> Mover para…</button>
          <button role="menuitem" onClick={close(() => void junk(list))}><Icon name="junkemail" size={16}/> {wellKnown === "junkemail" ? "Não é lixo" : "Marcar como lixo"}</button>
          <hr/>
          <button role="menuitem" onClick={close(() => void markRead(list, list.some(item => !item.isRead)))}><Icon name={list.some(item => !item.isRead) ? "mailOpen" : "mail"} size={16}/> {list.some(item => !item.isRead) ? "Marcar como lida" : "Marcar como não lida"}</button>
          <button role="menuitem" onClick={close(() => void toggleFlag(list))}><Icon name="flag" size={16}/> {list.some(item => item.flag?.flagStatus === "flagged") ? "Limpar sinalizador" : "Sinalizar"}</button>
          <button role="menuitem" onClick={close(() => setCategoryFor({ rows: menu.rows, x: menu.x, y: menu.y }))}><Icon name="tag" size={16}/> Categorizar…</button>
        </>; })()}
      </div>
    </div>}

    {categoryFor && <div className="ol-overlay" onClick={() => setCategoryFor(null)}>
      <div className="ol-menu context categories" role="menu" style={{ left: Math.min(categoryFor.x, window.innerWidth - 260), top: Math.min(categoryFor.y, window.innerHeight - 420) }} onClick={event => event.stopPropagation()}>
        {(() => { const list = categoryFor.rows.flatMap(row => row.items); const names = [...new Set([...categories.map(item => item.displayName), ...messages.flatMap(item => item.categories ?? [])])]; return <>
          {names.map(name => { const on = list.length > 0 && list.every(item => item.categories?.includes(name)); return <button key={name} role="menuitemcheckbox" aria-checked={on} onClick={() => void toggleCategory(list, name)}><span className="ol-cat-dot" style={{ background: categoryColor(categories, name) }}/>{name}{on && <Icon name="check" size={15} className="ol-menu-check"/>}</button>; })}
          <hr/><button role="menuitem" onClick={() => { setCategoryFor(null); void clearCategories(list); }}><Icon name="eraser" size={16}/> Limpar categorias</button>
        </>; })()}
      </div>
    </div>}

    {moveFor && <MoveDialog folders={folders} all={allFolders} current={currentFolder?.id} onLoadAll={async () => { if (allFolders) return; try { const result = await mailRequest("/api/mail/folders?all=1"); setAllFolders([...result.folders, ...result.all]); } catch (reason) { fail(reason); } }} onClose={() => setMoveFor(null)} onPick={folder => { const list = moveFor.flatMap(row => row.items); setMoveFor(null); void moveTo(list, folder.wellKnown ?? folder.id, `movida(s) para ${folder.displayName}`); }}/>}

    {help && <div className="ol-overlay dim" onClick={() => setHelp(false)}><div className="ol-dialog" role="dialog" aria-label="Atalhos de teclado" onClick={event => event.stopPropagation()}>
      <header><h2>Atalhos de teclado</h2><button className="ol-icon" onClick={() => setHelp(false)} aria-label="Fechar"><Icon name="close"/></button></header>
      <dl className="ol-shortcuts">{[["N ou Ctrl+N", "Novo email"], ["R ou Ctrl+R", "Responder"], ["A ou Ctrl+Shift+R", "Responder a todos"], ["F ou Ctrl+F", "Reencaminhar"], ["Ctrl+Enter", "Enviar (no editor)"], ["Delete ou #", "Eliminar"], ["E", "Arquivar"], ["V", "Mover para pasta"], ["S ou Insert", "Sinalizar / limpar"], ["U", "Lida / não lida"], ["Ctrl+Q / Ctrl+U", "Marcar como lida / não lida"], ["J / K ou ↓ / ↑", "Mensagem seguinte / anterior"], ["Ctrl+clique / Shift+clique", "Selecionar várias"], ["/", "Pesquisar"], ["Esc", "Fechar menu ou limpar seleção"]].map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl>
    </div></div>}

    {toast && <div className={"ol-toast" + (toast.error ? " error" : "")} role={toast.error ? "alert" : "status"}><span>{toast.text}</span>{toast.undo && <button onClick={() => { const undo = toast.undo; setToast(null); void undo?.().catch(fail); }}>Anular</button>}<button className="ol-icon" aria-label="Fechar aviso" onClick={() => setToast(null)}><Icon name="close" size={14}/></button></div>}
  </div>;
}

function MoveDialog({ folders, all, current, onLoadAll, onClose, onPick }: { folders: Folder[]; all: Folder[] | null; current?: string; onLoadAll: () => Promise<void>; onClose: () => void; onPick: (folder: Folder) => void }) {
  const [text, setText] = useState("");
  const [loadingAll, setLoadingAll] = useState(false);
  const load = useRef(onLoadAll);
  // Loads the full folder tree once, when the dialog opens.
  useEffect(() => { setLoadingAll(true); void load.current().finally(() => setLoadingAll(false)); }, []);
  const source = all ?? folders;
  const needle = text.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const list = source.filter(folder => folder.id !== current && folder.wellKnown !== "drafts" && folder.wellKnown !== "outbox" && (!needle || folder.displayName.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").includes(needle))).slice(0, 200);
  const parentName = (folder: Folder) => source.find(item => item.id === folder.parentFolderId)?.displayName;
  return <div className="ol-overlay dim" onClick={onClose}><div className="ol-dialog move" role="dialog" aria-label="Mover para pasta" onClick={event => event.stopPropagation()}>
    <header><h2>Mover para</h2><button className="ol-icon" onClick={onClose} aria-label="Fechar"><Icon name="close"/></button></header>
    <label className="ol-search small"><Icon name="search" size={16}/><input autoFocus value={text} onChange={event => setText(event.target.value)} placeholder="Procurar pasta (ex.: cliente, fabricante)…" aria-label="Procurar pasta"/></label>
    {loadingAll && !all && <p className="ol-muted"><span className="ol-spinner"/> A carregar todas as subpastas…</p>}
    <ul className="ol-move-list">{list.map(folder => <li key={folder.id}><button onClick={() => onPick(folder)}><Icon name={folder.wellKnown ?? "folder"} size={16}/><span>{folder.displayName}</span>{parentName(folder) && <small>{parentName(folder)}</small>}</button></li>)}{!list.length && <li className="ol-muted">Nenhuma pasta encontrada.</li>}</ul>
  </div></div>;
}
