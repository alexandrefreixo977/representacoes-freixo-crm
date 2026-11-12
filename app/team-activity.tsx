"use client";
// Administração › Atividade da equipa: entradas, saídas, tempo de utilização e tudo o que cada utilizador fez no CRM.
// Só os administradores conseguem ler estes registos (regras de acesso na base de dados).
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { describeActivity, formatMinutes, isOnline, sessionEnd, summarize, type ActivityLog, type ActivitySession } from "./activity-describe";

type Profile = { id: string; full_name: string; role: string; active: boolean };
type Pending = { id: string; title: string; kind: string; status: string; due: string; client: string; assignedTo: string };
type Period = "hoje" | "ontem" | "7" | "30" | "dia";

const TZ = "Europe/Lisbon";
const MODULES = ["Dashboard", "Agenda", "Clientes", "Visitas", "Tarefas", "Oportunidades", "Fabricantes", "Correio", "Relatórios"];
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-PT", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function range(period: Period, chosen: string): [Date, Date] {
  const today = startOfDay(new Date());
  const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (period === "ontem") return [add(today, -1), today];
  if (period === "7") return [add(today, -6), add(today, 1)];
  if (period === "30") return [add(today, -29), add(today, 1)];
  if (period === "dia" && chosen) { const d = startOfDay(new Date(`${chosen}T12:00:00`)); return [d, add(d, 1)]; }
  return [today, add(today, 1)];
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export default function TeamActivity({ session }: { session: Session }) {
  const [period, setPeriod] = useState<Period>("hoje");
  const [chosen, setChosen] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [userId, setUserId] = useState("todos");
  const [filter, setFilter] = useState<"tudo" | "alteração" | "navegação" | "acesso">("tudo");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [names, setNames] = useState<{ clients: Map<string, string>; manufacturers: Map<string, string> }>({ clients: new Map(), manufacturers: new Map() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [reload, setReload] = useState(0);
  const [from, to] = useMemo(() => range(period, chosen), [period, chosen]);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from("profiles").select("id,full_name,role,active").order("full_name"),
      supabase.from("clients").select("id,trade_name"),
      supabase.from("manufacturers").select("id,name"),
    ]).then(([p, c, m]) => {
      if (!active) return;
      setProfiles((p.data ?? []) as Profile[]);
      setNames({ clients: new Map((c.data ?? []).map((r: any) => [r.id, r.trade_name])), manufacturers: new Map((m.data ?? []).map((r: any) => [r.id, r.name])) });
    });
    return () => { active = false; };
  }, [session.user.id]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const LIMIT = 1000;
    let s = supabase.from("crm_sessions").select("id,user_id,started_at,last_seen_at,ended_at,end_reason,device").lt("started_at", to.toISOString()).gte("last_seen_at", from.toISOString()).order("started_at", { ascending: false }).limit(2000);
    let l = supabase.from("crm_activity_log").select("id,user_id,session_id,kind,module,entity_table,entity_id,label,detail,created_at").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()).order("created_at", { ascending: false }).limit(LIMIT);
    let a = supabase.from("activities").select("id,title,summary,kind,status,start_at,due_date,assigned_to,clients(trade_name)").in("kind", ["task", "visit"]).in("status", ["scheduled", "in_progress", "open"]).lt("due_date", new Date().toLocaleDateString("sv-SE")).order("due_date").limit(300);
    if (userId !== "todos") { s = s.eq("user_id", userId); l = l.eq("user_id", userId); a = a.eq("assigned_to", userId); }
    Promise.all([s, l, a]).then(([sr, lr, ar]) => {
      if (!active) return;
      if (sr.error || lr.error) { setError("Não foi possível carregar o registo de atividade. Confirme que a base de dados já tem o registo ativo (script 014)."); setLoading(false); return; }
      setSessions((sr.data ?? []) as ActivitySession[]);
      setLogs((lr.data ?? []) as ActivityLog[]);
      setTruncated((lr.data ?? []).length >= LIMIT);
      setPending(ar.error ? [] : (ar.data ?? []).map((r: any) => ({ id: r.id, title: r.title ?? r.summary ?? "", kind: r.kind, status: r.status, due: r.due_date ?? r.start_at ?? "", client: r.clients?.trade_name ?? "", assignedTo: r.assigned_to })));
      setLoading(false);
    });
    return () => { active = false; };
  }, [from, to, userId, reload]);

  useEffect(() => { const t = window.setInterval(() => setReload(r => r + 1), 60_000); return () => window.clearInterval(t); }, []);

  const nameOf = (id: string) => profiles.find(p => p.id === id)?.full_name ?? "Utilizador";
  const shownUsers = useMemo(() => {
    const ids = userId !== "todos" ? [userId] : [...new Set([...profiles.filter(p => p.active).map(p => p.id), ...sessions.map(s => s.user_id), ...logs.map(l => l.user_id)])];
    return ids.map(id => summarize(id, sessions, logs, +from, +to)).sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), "pt"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profiles, sessions, logs, from, to]);

  const timeline = useMemo(() => logs.map(l => ({ log: l, ...describeActivity(l, names) })).filter(e => filter === "tudo" || e.group === filter || (filter === "alteração" && e.group === "pesquisa")), [logs, names, filter]);
  const byDay = useMemo(() => { const m = new Map<string, typeof timeline>(); for (const e of timeline) { const k = dayKey(e.log.created_at); m.set(k, [...(m.get(k) ?? []), e]); } return [...m.entries()]; }, [timeline]);

  const exportCsv = () => {
    const rows = [["Data", "Hora", "Utilizador", "Ação", "Detalhe"], ...timeline.slice().reverse().map(e => [dayKey(e.log.created_at), time(e.log.created_at), nameOf(e.log.user_id), e.text, e.extra])];
    const blob = new Blob(["﻿" + rows.map(r => r.map(csvCell).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `atividade-crm-${dayKey(from.toISOString())}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return <div className="team-activity">
    <div className="page-title"><div><span>ADMINISTRAÇÃO</span><h1>Atividade da equipa</h1></div>
      <button type="button" className="ta-export" onClick={exportCsv} disabled={!timeline.length}>Exportar Excel (CSV)</button></div>
    <p className="ta-note">Visível apenas para administradores. Regista entradas e saídas, o tempo de utilização, as páginas e fichas abertas, as pesquisas e todas as criações, alterações e eliminações feitas no CRM. A sessão termina ao sair ou após 20 minutos sem utilização. Registos guardados durante 12 meses.</p>

    <div className="card ta-filters">
      <label>Utilizador<select value={userId} onChange={e => setUserId(e.target.value)}>
        <option value="todos">Todos</option>
        {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.role === "admin" ? " (admin)" : ""}{p.active ? "" : " — inativo"}</option>)}
      </select></label>
      <div className="ta-periods" role="group" aria-label="Período">
        {([["hoje", "Hoje"], ["ontem", "Ontem"], ["7", "7 dias"], ["30", "30 dias"], ["dia", "Escolher dia"]] as const).map(([k, l]) =>
          <button key={k} type="button" className={period === k ? "active" : ""} onClick={() => setPeriod(k)}>{l}</button>)}
        {period === "dia" && <input type="date" value={chosen} max={new Date().toLocaleDateString("sv-SE")} onChange={e => setChosen(e.target.value)} />}
      </div>
    </div>

    {error && <p className="ta-error" role="alert">{error}</p>}
    {loading && !logs.length && !error && <p className="ta-muted">A carregar…</p>}

    <section className="ta-users">
      {shownUsers.map(u => {
        const notVisited = MODULES.filter(m => !u.modules.has(m));
        return <article key={u.userId} className="card ta-user">
          <header><strong>{nameOf(u.userId)}</strong>{u.online ? <span className="ta-badge on">Online agora</span> : u.entries ? <span className="ta-badge">Offline</span> : <span className="ta-badge off">Não entrou</span>}</header>
          <dl>
            <div><dt>Entradas</dt><dd>{u.entries}</dd></div>
            <div><dt>1.ª entrada</dt><dd>{u.firstEntry ? `${period === "hoje" || period === "ontem" || period === "dia" ? "" : day(u.firstEntry) + " "}${time(u.firstEntry)}` : "—"}</dd></div>
            <div><dt>Última saída</dt><dd>{u.online ? "—" : u.lastExit ? `${period === "hoje" || period === "ontem" || period === "dia" ? "" : day(u.lastExit) + " "}${time(u.lastExit)}` : "—"}</dd></div>
            <div><dt>Tempo ativo</dt><dd>{formatMinutes(u.activeMinutes)}</dd></div>
            <div><dt>Criou</dt><dd>{u.created}</dd></div>
            <div><dt>Editou</dt><dd>{u.updated}</dd></div>
            <div><dt>Apagou</dt><dd>{u.deleted}</dd></div>
            <div><dt>Clientes abertos</dt><dd>{u.clientsOpened}</dd></div>
          </dl>
          {u.entries > 0 && <p className="ta-muted">Não abriu: {notVisited.length ? notVisited.join(", ") : "abriu todos os módulos"}{u.devices.size ? ` · Dispositivo: ${[...u.devices].join(", ")}` : ""}</p>}
        </article>;
      })}
    </section>

    <section className="card ta-block">
      <h2>Entradas e saídas</h2>
      {sessions.length === 0 ? <p className="ta-muted">Sem entradas neste período.</p> :
        <div className="ta-table"><table><thead><tr><th>Dia</th><th>Utilizador</th><th>Entrada</th><th>Saída</th><th>Duração</th><th>Dispositivo</th></tr></thead><tbody>
          {sessions.map(s => { const online = isOnline(s); const mins = Math.max(0, Math.round((Date.parse(sessionEnd(s)) - Date.parse(s.started_at)) / 60000)); return <tr key={s.id}>
            <td>{day(s.started_at)}</td><td>{nameOf(s.user_id)}</td><td>{time(s.started_at)}</td>
            <td>{online ? <span className="ta-badge on">Online</span> : <>{time(sessionEnd(s))} <small>{s.end_reason === "logout" ? "saiu" : "inatividade"}</small></>}</td>
            <td>{formatMinutes(mins)}</td><td>{s.device ?? "—"}</td></tr>; })}
        </tbody></table></div>}
    </section>

    <section className="card ta-block">
      <div className="ta-block-head"><h2>O que fez</h2>
        <div className="ta-periods" role="group" aria-label="Tipo">
          {([["tudo", "Tudo"], ["alteração", "Alterações e pesquisas"], ["navegação", "Navegação"], ["acesso", "Entradas/saídas"]] as const).map(([k, l]) =>
            <button key={k} type="button" className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div></div>
      {truncated && <p className="ta-muted">A mostrar os 1000 registos mais recentes. Escolha um período mais curto ou um utilizador para ver tudo.</p>}
      {byDay.length === 0 ? <p className="ta-muted">Sem atividade neste período.</p> : byDay.map(([k, entries]) => <div key={k} className="ta-day">
        <h3>{day(entries[0].log.created_at)} <small>{entries.length} registos</small></h3>
        <ol>{entries.map(e => <li key={e.log.id} className={`ta-${e.group === "alteração" ? "change" : e.group === "navegação" ? "nav" : e.group === "pesquisa" ? "search" : "access"} ta-${e.log.kind}`}>
          <time>{time(e.log.created_at)}</time>
          {userId === "todos" && <b>{nameOf(e.log.user_id).split(" ")[0]}</b>}
          <span>{e.text}{e.extra && <small>{e.extra}</small>}</span>
        </li>)}</ol>
      </div>)}
    </section>

    <section className="card ta-block">
      <h2>O que ficou por fazer</h2>
      <p className="ta-muted">Tarefas e visitas com data já passada que continuam por concluir{userId === "todos" ? "" : ` (atribuídas a ${nameOf(userId)})`}.</p>
      {pending.length === 0 ? <p className="ta-muted">Nada em atraso.</p> :
        <div className="ta-table"><table><thead><tr><th>Data</th><th>Tipo</th><th>Assunto</th><th>Cliente</th>{userId === "todos" && <th>Responsável</th>}</tr></thead><tbody>
          {pending.map(p => <tr key={p.id}><td>{p.due ? new Date(`${p.due.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-PT") : "—"}</td><td>{p.kind === "visit" ? "Visita" : "Tarefa"}</td><td>{p.title}</td><td>{p.client}</td>{userId === "todos" && <td>{nameOf(p.assignedTo)}</td>}</tr>)}
        </tbody></table></div>}
    </section>
  </div>;
}
