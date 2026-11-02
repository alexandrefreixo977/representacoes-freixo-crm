"use client";
import { useId } from "react";
export default function MailRecipientField({ label, values, draft, onDraft, onCommit, onRemove, contacts }: {
  label: string; values: string[]; draft: string; onDraft: (value: string) => void; onCommit: (value: string) => void; onRemove: (address: string) => void; contacts: { email: string; name: string }[];
}) {
  const id = useId();
  return <div className="mail-recipient-field"><label htmlFor={id}>{label}</label>
    <div className="mail-recipient-input"><ul aria-label={`Destinatários ${label}`}>{values.map(address => <li key={address}><span>{address}</span><button type="button" aria-label={`Remover ${address} de ${label}`} onClick={() => onRemove(address)}>×</button></li>)}</ul>
    <input id={id} list={id + "-contacts"} value={draft} autoComplete="off" aria-describedby={id + "-hint"} placeholder="Adicionar email ou pesquisar contacto…"
      onChange={event => { const value = event.target.value; if (/[;,\n]/.test(value)) onCommit(value); else onDraft(value); }}
      onKeyDown={event => { if (event.key === "Enter" || event.key === "," || event.key === ";") { event.preventDefault(); onCommit(draft); } }}
      onBlur={() => { if (draft.trim()) onCommit(draft); }}/>
    <datalist id={id + "-contacts"}>{contacts.map(contact => <option key={contact.email} value={contact.email}>{contact.name}</option>)}</datalist></div>
    <small id={id + "-hint"}>Enter, vírgula ou ponto e vírgula para adicionar.{label !== "Para" && " Opcional."}</small>
  </div>;
}
