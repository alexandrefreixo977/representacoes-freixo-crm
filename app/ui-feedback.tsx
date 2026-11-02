"use client";
// Avisos discretos (toast) e janelas de confirmação/texto próprias do CRM, em vez de alert/confirm/prompt do browser.
// Uso: toast("Guardado"), toast("Tarefa concluída", { action: { label: "Anular", run } }),
//      if (await askConfirm({ title, message, danger: true })) …, const v = await askText({ title, label, value }).
import { useEffect, useRef, useState } from "react";

type ToastAction = { label: string; run: () => void | Promise<void> };
type Toast = { id: number; text: string; tone: "ok" | "error"; action?: ToastAction };
type Dialog =
  | { kind: "confirm"; title: string; message?: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: "text"; title: string; label?: string; value: string; placeholder?: string; multiline: boolean; required: boolean; confirmLabel: string; resolve: (v: string | null) => void };

let pushToast: ((t: Omit<Toast, "id">) => void) | null = null;
let openDialog: ((d: Dialog) => void) | null = null;

export function toast(text: string, options: { tone?: "ok" | "error"; action?: ToastAction } = {}) {
  if (pushToast) pushToast({ text, tone: options.tone ?? "ok", action: options.action });
}
export function askConfirm(o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  if (!openDialog) return Promise.resolve(typeof window !== "undefined" && window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title));
  return new Promise(resolve => openDialog!({ kind: "confirm", title: o.title, message: o.message, confirmLabel: o.confirmLabel ?? "Confirmar", danger: Boolean(o.danger), resolve }));
}
export function askText(o: { title: string; label?: string; value?: string; placeholder?: string; multiline?: boolean; required?: boolean; confirmLabel?: string }): Promise<string | null> {
  if (!openDialog) return Promise.resolve(typeof window !== "undefined" ? window.prompt(o.title, o.value ?? "") : null);
  return new Promise(resolve => openDialog!({ kind: "text", title: o.title, label: o.label, value: o.value ?? "", placeholder: o.placeholder, multiline: Boolean(o.multiline), required: o.required ?? false, confirmLabel: o.confirmLabel ?? "Guardar", resolve }));
}

export function FeedbackHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [text, setText] = useState("");
  const seq = useRef(0);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    pushToast = t => {
      const id = ++seq.current;
      setToasts(list => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), t.action ? 7000 : 4000);
    };
    openDialog = d => { setDialog(d); setText(d.kind === "text" ? d.value : ""); };
    return () => { pushToast = null; openDialog = null; };
  }, []);
  useEffect(() => { if (dialog) setTimeout(() => (dialog.kind === "text" ? field.current : confirmBtn.current)?.focus(), 30); }, [dialog]);

  const close = (ok: boolean) => {
    if (!dialog) return;
    if (dialog.kind === "confirm") dialog.resolve(ok);
    else dialog.resolve(ok ? text.trim() : null);
    setDialog(null);
  };
  const blocked = dialog?.kind === "text" && dialog.required && !text.trim();

  return <>
    <div className="ui-toasts" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`ui-toast ${t.tone}`}>
        <span>{t.tone === "error" ? "⚠" : "✓"}</span><p>{t.text}</p>
        {t.action && <button onClick={() => { setToasts(list => list.filter(x => x.id !== t.id)); void t.action!.run(); }}>{t.action.label}</button>}
        <button className="ui-toast-close" aria-label="Fechar" onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}>×</button>
      </div>)}
    </div>
    {dialog && <div className="ui-dialog-backdrop" onMouseDown={() => close(false)}>
      <form className="ui-dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === "Escape") close(false); }}
        onSubmit={e => { e.preventDefault(); if (!blocked) close(true); }}>
        <h3>{dialog.title}</h3>
        {dialog.kind === "confirm" && dialog.message && <p>{dialog.message}</p>}
        {dialog.kind === "text" && <label>{dialog.label}
          {dialog.multiline
            ? <textarea ref={field} value={text} placeholder={dialog.placeholder} onChange={e => setText(e.target.value)} rows={4} />
            : <input ref={field} value={text} placeholder={dialog.placeholder} onChange={e => setText(e.target.value)} />}
        </label>}
        <div className="ui-dialog-actions">
          <button type="button" onClick={() => close(false)}>Cancelar</button>
          <button ref={confirmBtn} type="submit" className={dialog.kind === "confirm" && dialog.danger ? "danger" : "primary"} disabled={blocked}>{dialog.confirmLabel}</button>
        </div>
      </form>
    </div>}
  </>;
}
