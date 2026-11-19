"use client";
import { useEffect, useRef } from "react";
import Icon from "./icons";
import { avatarColor, categoryColor, dateGroup, FILTER_LABELS, initials, listDate, messageDate, personName, type Category, type MailFilter, type Msg } from "./shared";

export type Row = { key: string; latest: Msg; items: Msg[] };

type Props = {
  title: string;
  rows: Row[];
  selected: Set<string>;
  active: string | null;
  loading: boolean;
  error: string;
  hasMore: boolean;
  filter: MailFilter;
  searching: boolean;
  outgoing: boolean;
  categories: Category[];
  conversations: boolean;
  onFilter: (filter: MailFilter) => void;
  onOpen: (row: Row, event: React.MouseEvent | React.KeyboardEvent) => void;
  onToggle: (row: Row, event: React.MouseEvent | React.ChangeEvent) => void;
  onSelectAll: (all: boolean) => void;
  onMore: () => void;
  onQuick: (row: Row, action: "delete" | "archive" | "flag" | "read") => void;
  onContext: (row: Row, x: number, y: number) => void;
  onToggleConversations: () => void;
  onMenu?: () => void;
  onRetry: () => void;
};

export default function MessageList(props: Props) {
  const { rows, selected, active, loading, error, hasMore, filter, searching, outgoing, categories } = props;
  const sentinel = useRef<HTMLLIElement | null>(null);
  const onMore = useRef(props.onMore); onMore.current = props.onMore;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) onMore.current(); }, { rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, rows.length]);
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.key));
  let lastGroup = "";
  return <section className="ol-list" aria-label="Lista de mensagens" aria-busy={loading}>
    <header className="ol-list-head">
      {props.onMenu && <button className="ol-icon ol-only-mobile" onClick={props.onMenu} aria-label="Pastas"><Icon name="menu"/></button>}
      <label className="ol-check" title="Selecionar tudo"><input type="checkbox" checked={allSelected} onChange={event => props.onSelectAll(event.target.checked)} aria-label="Selecionar todas as mensagens"/></label>
      <h2 title={props.title}>{props.title}</h2>
      <button className={"ol-icon" + (props.conversations ? " on" : "")} title={props.conversations ? "Mostrar mensagens individuais" : "Agrupar por conversa"} aria-pressed={props.conversations} onClick={props.onToggleConversations}><Icon name="conversation" size={17}/></button>
      <label className="ol-filter" title="Filtrar"><Icon name="filter" size={15}/><select value={filter} onChange={event => props.onFilter(event.target.value as MailFilter)} aria-label="Filtrar mensagens">{(Object.keys(FILTER_LABELS) as MailFilter[]).map(key => <option key={key} value={key}>{FILTER_LABELS[key]}</option>)}</select></label>
    </header>
    {error && <div className="ol-list-error" role="alert"><p>{error}</p><button onClick={props.onRetry}>Tentar novamente</button></div>}
    {!rows.length && !error && <div className="ol-empty" role="status">{loading ? <><span className="ol-spinner"/>A carregar mensagens…</> : <><Icon name="inbox" size={42}/><strong>{searching ? "Sem resultados" : filter !== "all" ? "Nada para mostrar com este filtro" : "Esta pasta está vazia"}</strong><span>{searching ? "Experimente outras palavras ou pesquise em todas as pastas." : "Não há mensagens aqui."}</span></>}</div>}
    <ul className="ol-rows" role="listbox" aria-multiselectable="true" aria-label="Mensagens">
      {rows.map(row => {
        const message = row.latest;
        const group = searching ? "" : dateGroup(messageDate(message));
        const header = group !== lastGroup ? group : ""; lastGroup = group;
        const unread = row.items.some(item => !item.isRead && !item.isDraft);
        const flagged = row.items.some(item => item.flag?.flagStatus === "flagged");
        const done = !flagged && row.items.some(item => item.flag?.flagStatus === "complete");
        const attachments = row.items.some(item => item.hasAttachments);
        const important = row.items.some(item => item.importance === "high");
        const party = outgoing || message.direction === "out" ? message.toRecipients?.[0] : message.from;
        const name = message.isDraft && !message.toRecipients?.length ? "(sem destinatário)" : (outgoing && message.toRecipients && message.toRecipients.length > 1 ? message.toRecipients.map(item => personName(item).split(" ")[0]).join("; ") : personName(party));
        const tags = [...new Set(row.items.flatMap(item => item.categories ?? []))];
        const isSelected = selected.has(row.key);
        return [header && <li key={"g:" + header + row.key} className="ol-group" role="presentation">{header}</li>,
          <li key={row.key} role="option" aria-selected={isSelected || active === row.key} className={"ol-row" + (unread ? " unread" : "") + (isSelected ? " selected" : "") + (active === row.key ? " active" : "") + (flagged ? " flagged" : "")}
            draggable onDragStart={event => { const ids = isSelected ? rows.filter(item => selected.has(item.key)).flatMap(item => item.items.map(m => m.id)) : row.items.map(m => m.id); event.dataTransfer.setData("application/x-rf-mail", JSON.stringify(ids)); event.dataTransfer.effectAllowed = "move"; }}
            onContextMenu={event => { event.preventDefault(); props.onContext(row, event.clientX, event.clientY); }}>
            <span className="ol-avatar" style={{ background: avatarColor(name) }} aria-hidden="true">{initials(name)}</span>
            <label className="ol-check ol-row-check"><input type="checkbox" checked={isSelected} onChange={event => props.onToggle(row, event)} aria-label={"Selecionar " + (message.subject || "Sem assunto")}/></label>
            <button className="ol-row-main" onClick={event => props.onOpen(row, event)} onKeyDown={event => { if (event.key === "Enter") props.onOpen(row, event); }}>
              <span className="ol-row-line">
                <span className="ol-from">{message.isDraft && <em className="ol-draft-tag">[Rascunho] </em>}{name}</span>
                {row.items.length > 1 && <span className="ol-count" title={row.items.length + " mensagens nesta conversa"}>{row.items.length}</span>}
                <span className="ol-row-icons">{important && <span className="ol-important" title="Importância alta">!</span>}{attachments && <Icon name="paperclip" size={14}/>}</span>
                <time dateTime={messageDate(message)}>{listDate(messageDate(message))}</time>
              </span>
              <span className="ol-row-line"><span className="ol-subject">{message.subject || "(Sem assunto)"}</span>{message.lead && <span className="ol-badge lead" title="Remetente ainda não está no CRM">Lead</span>}</span>
              <span className="ol-preview">{message.bodyPreview || "Esta mensagem não tem texto de pré-visualização."}</span>
              {(tags.length > 0 || message.entidade?.nome) && <span className="ol-tags">{message.entidade?.nome && <span className="ol-badge entity" title={message.entidade.tipo === "fabricante" ? "Fabricante no CRM" : "Cliente no CRM"}>{message.entidade.nome}</span>}{tags.map(tag => <span key={tag} className="ol-category" style={{ "--cat": categoryColor(categories, tag) } as React.CSSProperties}>{tag}</span>)}</span>}
            </button>
            <span className="ol-quick" role="group" aria-label="Ações rápidas">
              <button onClick={() => props.onQuick(row, "delete")} title="Eliminar" aria-label="Eliminar"><Icon name="trash" size={16}/></button>
              <button onClick={() => props.onQuick(row, "archive")} title="Arquivar" aria-label="Arquivar"><Icon name="archive" size={16}/></button>
              <button onClick={() => props.onQuick(row, "read")} title={unread ? "Marcar como lida" : "Marcar como não lida"} aria-label={unread ? "Marcar como lida" : "Marcar como não lida"}><Icon name={unread ? "mailOpen" : "mail"} size={16}/></button>
            </span>
            <button className={"ol-flag" + (flagged ? " on" : done ? " done" : "")} onClick={() => props.onQuick(row, "flag")} title={flagged ? "Limpar sinalizador" : "Sinalizar"} aria-label={flagged ? "Limpar sinalizador" : "Sinalizar"} aria-pressed={flagged}><Icon name={done ? "check" : "flag"} size={15} filled={flagged}/></button>
          </li>];
      })}
      {hasMore && <li ref={sentinel} className="ol-more" role="presentation"><button disabled={loading} onClick={props.onMore}>{loading ? "A carregar…" : "Carregar mais mensagens"}</button></li>}
    </ul>
  </section>;
}
