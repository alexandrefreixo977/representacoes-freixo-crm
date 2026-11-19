"use client";
import { useState } from "react";
import Icon from "./icons";
import type { Folder } from "./shared";

type Props = {
  folders: Folder[];
  subfolders: Record<string, Folder[]>;
  current: string;
  favourites: string[];
  account: string;
  onOpen: (folder: Folder) => void;
  onExpand: (folder: Folder) => Promise<void>;
  onToggleFavourite: (folder: Folder) => void;
  onDropMessages: (folder: Folder, ids: string[]) => void;
  onCompose: () => void;
};

const ICON: Record<string, string> = { inbox: "inbox", drafts: "drafts", sentitems: "sentitems", deleteditems: "deleteditems", junkemail: "junkemail", archive: "archive", outbox: "outbox" };

export default function FolderPane({ folders, subfolders: children, current, favourites, account, onOpen, onExpand, onToggleFavourite, onDropMessages, onCompose }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState("");
  const [over, setOver] = useState("");
  const [showFavourites, setShowFavourites] = useState(true);
  const [showAll, setShowAll] = useState(true);
  const all = [...folders, ...Object.values(children).flat()];
  const favouriteFolders = favourites.map(id => all.find(folder => folder.id === id || folder.wellKnown === id)).filter((folder): folder is Folder => Boolean(folder));

  const toggle = async (folder: Folder) => {
    const next = new Set(open);
    if (next.has(folder.id)) next.delete(folder.id);
    else {
      next.add(folder.id);
      if (!children[folder.id]) { setLoading(folder.id); try { await onExpand(folder); } finally { setLoading(""); } }
    }
    setOpen(next);
  };

  const row = (folder: Folder, depth: number, key: string) => {
    const active = current === folder.id || current === folder.wellKnown;
    const unread = folder.wellKnown === "drafts" ? folder.totalItemCount : folder.unreadItemCount;
    const favourite = favourites.includes(folder.wellKnown ?? folder.id);
    return <li key={key} role="none">
      <div className={"ol-folder" + (active ? " active" : "") + (over === key ? " drop" : "")} style={{ paddingLeft: 8 + depth * 14 }}
        onDragOver={event => { if (event.dataTransfer.types.includes("application/x-rf-mail")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(key); } }}
        onDragLeave={() => setOver(previous => previous === key ? "" : previous)}
        onDrop={event => { event.preventDefault(); setOver(""); try { const ids = JSON.parse(event.dataTransfer.getData("application/x-rf-mail")); if (Array.isArray(ids) && ids.length) onDropMessages(folder, ids); } catch { /* not a mail drag */ } }}>
        {folder.childFolderCount ? <button className="ol-twisty" aria-label={(open.has(folder.id) ? "Fechar " : "Abrir ") + folder.displayName} aria-expanded={open.has(folder.id)} onClick={() => void toggle(folder)}><Icon name={open.has(folder.id) ? "down" : "chevron"} size={14}/></button> : <span className="ol-twisty"/>}
        <button className="ol-folder-name" role="treeitem" aria-selected={active} onClick={() => onOpen(folder)} title={folder.displayName}>
          <Icon name={ICON[folder.wellKnown ?? ""] ?? "folder"} size={17}/>
          <span>{folder.displayName}</span>
          {!!unread && <b className={folder.wellKnown === "drafts" ? "muted" : ""}>{unread}</b>}
        </button>
        <button className={"ol-fav-toggle" + (favourite ? " on" : "")} title={favourite ? "Remover dos Favoritos" : "Adicionar aos Favoritos"} aria-label={(favourite ? "Remover dos Favoritos: " : "Adicionar aos Favoritos: ") + folder.displayName} onClick={() => onToggleFavourite(folder)}><Icon name="star" size={13} filled={favourite}/></button>
      </div>
      {open.has(folder.id) && <ul role="group">{loading === folder.id ? <li className="ol-folder-loading">A carregar…</li> : (children[folder.id] ?? []).map(child => row(child, depth + 1, key + "/" + child.id))}</ul>}
    </li>;
  };

  return <nav className="ol-folders" aria-label="Pastas de correio">
    <button className="ol-new" onClick={onCompose}><Icon name="compose" size={17}/> Novo email</button>
    <div className="ol-folder-scroll">
      <button className="ol-section" aria-expanded={showFavourites} onClick={() => setShowFavourites(value => !value)}><Icon name={showFavourites ? "down" : "chevron"} size={13}/> Favoritos</button>
      {showFavourites && <ul role="tree" aria-label="Favoritos">{favouriteFolders.map(folder => row(folder, 0, "fav:" + folder.id))}</ul>}
      <button className="ol-section" aria-expanded={showAll} onClick={() => setShowAll(value => !value)} title={account}><Icon name={showAll ? "down" : "chevron"} size={13}/> <span>{account}</span></button>
      {showAll && <ul role="tree" aria-label="Todas as pastas">{folders.map(folder => row(folder, 0, folder.id))}</ul>}
    </div>
  </nav>;
}
