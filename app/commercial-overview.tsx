"use client";
// Visão comercial do dashboard: o que um diretor comercial quer ver de relance.
// Vendas da loja B2B, negócios do CRM, pipeline e previsão, equipa, clientes e marcas — sempre comparado com o período anterior equivalente.
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { B2B_SHOP_URL } from "./b2b-link";
import WebVisits from "./web-visits";
import { compactMoney, crmMetrics, delta, deltaPoints, monthLabel, percent, periodRange, type Delta, type MActivity, type MOpportunity, type MProfile, type MProposal, type PeriodKind } from "./sales-metrics";

type User = { id: string; name: string; role: "admin" | "commercial" };
type Client = { id?: string; name: string };
type Money = { valor: number; encomendas: number; clientes: number };
type B2BSales = {
  vendas: { atual: Money; anterior: Money };
  por_validar: { encomendas: number; valor: number };
  mensal: Array<{ mes: string; valor: number; encomendas: number }>;
  marcas: Array<{ marca: string; valor: number; encomendas: number; anterior: number }>;
  clientes: Array<{ nome: string; crm_client_id: string | null; valor: number; encomendas: number; anterior: number }>;
  sem_encomenda: Array<{ nome: string; crm_client_id: string | null; ultima: string; historico: number }>;
  propostas: { enviadas: number; aceites: number; perdidas: number; em_aberto: number; valor_aceite: number; valor_aberto: number };
  pedidos_acesso: number;
  clientes_loja: { ativos: number; com_encomenda: number };
};

const PERIODS: Array<[PeriodKind, string]> = [["week", "Semana"], ["month", "Mês"], ["quarter", "Trimestre"], ["year", "Ano"], ["12m", "12 meses"]];
const euro = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
const nf = new Intl.NumberFormat("pt-PT");
const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / 86400000));

function Kpi({ label, value, d, sub, hint, onClick, tone }: { label: string; value: string; d?: Delta | null; sub?: string; hint?: string; onClick?: () => void; tone?: "blue" | "green" | "amber" | "navy" }) {
  return (
    <button className={`co-kpi ${tone ?? "blue"}`} onClick={onClick} disabled={!onClick} title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
      <div>{d && <em className={`co-delta ${d.tone}`}>{d.text}</em>}{sub && <small>{sub}</small>}</div>
    </button>
  );
}

export default function CommercialOverview({ currentUser, session, clients, profiles, owner, setOwner, navigate, openClient, showDay }: {
  currentUser: User; session: Session; clients: Client[]; profiles: Array<{ id: string; name: string }>; owner: string; setOwner: (id: string) => void;
  navigate: (section: string, params?: Record<string, string>) => void; openClient: (client: any) => void; showDay: (anchor: string) => void;
}) {
  const initial = (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("periodo")) as PeriodKind | null;
  const [kind, setKind] = useState<PeriodKind>(initial && PERIODS.some(([k]) => k === initial) ? initial : "month");
  const range = useMemo(() => periodRange(kind), [kind]);
  const [data, setData] = useState<{ opportunities: MOpportunity[]; activities: MActivity[]; proposals: MProposal[]; profiles: MProfile[]; pendingProposals: number } | null>(null);
  const [b2b, setB2b] = useState<B2BSales | null>(null);
  const [b2bError, setB2bError] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener("focus", refresh); window.addEventListener("crm-records-changed", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("crm-records-changed", refresh); };
  }, []);

  // Dados do CRM: dois anos para trás chegam para qualquer comparação.
  useEffect(() => {
    let active = true;
    const since = new Date(Date.now() - 2 * 366 * 86400000).toISOString();
    Promise.all([
      supabase.from("opportunities").select("id,title,estimated_value,final_value,probability,outcome,created_at,closed_at,expected_close,last_activity_at,updated_at,loss_reason,seller_id,client_id,clients(trade_name),opportunity_stages(name,position),manufacturers(name)").order("updated_at", { ascending: false }).limit(3000),
      supabase.from("activities").select("kind,status,occurred_at,start_at,completed_at,assigned_to,actor_id,client_id").or(`occurred_at.gte.${since},start_at.gte.${since}`).limit(10000),
      supabase.from("catalog_orders").select("proposal_status,total,sent_at,accepted_at,seller_id").eq("document_type", "proposal").limit(3000),
      supabase.from("profiles").select("id,full_name,role,active").eq("active", true),
    ]).then(([o, a, p, pr]) => {
      if (!active) return;
      const err = o.error || a.error || p.error || pr.error;
      setError(err ? err.message : "");
      const weekAgo = Date.now() - 7 * 86400000;
      setData({
        opportunities: (o.data ?? []).map((x: any) => ({ id: x.id, title: x.title ?? "Oportunidade", client: x.clients?.trade_name ?? "Cliente", clientId: x.client_id, sellerId: x.seller_id, stage: x.opportunity_stages?.name ?? "Sem fase", stagePosition: x.opportunity_stages?.position ?? 99, probability: Number(x.probability ?? 0), value: Number(x.estimated_value ?? 0), finalValue: x.final_value === null || x.final_value === undefined ? null : Number(x.final_value), outcome: x.outcome ?? "active", createdAt: x.created_at, closedAt: x.closed_at, expectedClose: x.expected_close, lastActivityAt: x.last_activity_at, updatedAt: x.updated_at, lossReason: x.loss_reason, manufacturer: x.manufacturers?.name ?? null })),
        activities: (a.data ?? []).map((x: any) => ({ kind: x.kind ?? "note", status: x.status ?? "completed", at: x.completed_at ?? x.start_at ?? x.occurred_at, userId: x.assigned_to ?? x.actor_id, clientId: x.client_id })),
        proposals: (p.data ?? []).map((x: any) => ({ status: x.proposal_status, total: Number(x.total ?? 0), sentAt: x.sent_at, acceptedAt: x.accepted_at, sellerId: x.seller_id })),
        profiles: (pr.data ?? []).map((x: any) => ({ id: x.id, name: x.full_name ?? "Utilizador", role: x.role })),
        pendingProposals: (p.data ?? []).filter((x: any) => x.proposal_status === "sent" && x.sent_at && new Date(x.sent_at).getTime() < weekAgo).length,
      });
    });
    return () => { active = false; };
  }, [tick]);

  // Vendas da loja B2B (servidor: o comercial só vê os seus clientes).
  useEffect(() => {
    let active = true;
    setB2bError("");
    const q = new URLSearchParams({ from: range.from, to: range.to, prev_from: range.prevFrom, prev_to: range.prevTo, owner });
    fetch(`/api/b2b/sales?${q}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? "Sem dados da loja."); return body as B2BSales; })
      .then((s) => active && setB2b(s))
      .catch((e) => active && setB2bError(e instanceof Error ? e.message : "Sem dados da loja."));
    return () => { active = false; };
  }, [range, owner, session.access_token, tick]);

  const m = useMemo(() => data && crmMetrics({ ...data, range, owner }), [data, range, owner]);
  const choose = (k: PeriodKind) => {
    setKind(k);
    const params = new URLSearchParams(window.location.search); params.set("periodo", k); window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
  };
  const clientById = useMemo(() => new Map(clients.filter((c) => c.id).map((c) => [c.id as string, c])), [clients]);
  const openCrmClient = (id: string | null) => { const c = id && clientById.get(id); if (c) openClient(c); };
  const shop = () => window.open(`${B2B_SHOP_URL}/#/gestao`, "_blank", "noopener");

  const sales = b2b?.vendas;
  const avg = (x?: Money) => (x && x.encomendas ? x.valor / x.encomendas : 0);
  const proposalsSent = (m?.current.proposalsSent ?? 0) + (b2b?.propostas.enviadas ?? 0);
  const alerts = [
    b2b?.por_validar.encomendas ? { n: b2b.por_validar.encomendas, text: `encomendas da loja por validar (${euro(b2b.por_validar.valor)})`, go: shop, tone: "red" } : null,
    b2b?.pedidos_acesso ? { n: b2b.pedidos_acesso, text: "pedidos de acesso à loja por tratar", go: shop, tone: "amber" } : null,
    data?.pendingProposals ? { n: data.pendingProposals, text: "propostas sem resposta há mais de 7 dias", go: () => showDay("dash-propostas"), tone: "amber" } : null,
    m?.forecast.overdue ? { n: m.forecast.overdue, text: `negócios com fecho previsto já ultrapassado (${compactMoney(m.forecast.overdueValue)})`, go: () => navigate("Oportunidades", { status: "open" }), tone: "amber" } : null,
    m?.pipeline.stale ? { n: m.pipeline.stale, text: "oportunidades paradas há mais de 15 dias", go: () => navigate("Oportunidades", { stale: "15" }), tone: "amber" } : null,
    b2b?.sem_encomenda.length ? { n: b2b.sem_encomenda.length, text: "clientes da loja sem encomendar há mais de 60 dias", go: () => document.getElementById("co-reativar")?.scrollIntoView({ behavior: "smooth" }), tone: "blue" } : null,
  ].filter(Boolean) as Array<{ n: number; text: string; go: () => void; tone: string }>;

  const monthly = b2b?.mensal ?? [];
  const monthlyMax = Math.max(1, ...monthly.map((x) => x.valor));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const funnelMax = Math.max(1, ...(m?.funnel ?? []).map((s) => s.value));
  const brandTotal = (b2b?.marcas ?? []).reduce((s, x) => s + x.valor, 0) || 1;
  const forecastMax = Math.max(1, ...(m?.forecast.months ?? []).map((x) => x.value));

  return (
    <div className="commercial-overview">
      <div className="co-toolbar">
        <div className="period co-periods" role="tablist" aria-label="Período">
          {PERIODS.map(([k, label]) => <button key={k} className={kind === k ? "selected" : ""} onClick={() => choose(k)}>{label}</button>)}
        </div>
        {currentUser.role === "admin" && <select aria-label="Comercial" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Toda a equipa</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <span className="co-compare">{range.label} · comparado com {range.prevLabel}</span>
      </div>
      {error && <div className="email-notice">{error}</div>}

      {alerts.length > 0 && (
        <section className="co-alerts" aria-label="Pede a sua atenção">
          {alerts.map((a) => <button key={a.text} className={a.tone} onClick={a.go}><b>{a.n}</b>{a.text}</button>)}
        </section>
      )}

      <section className="co-kpis">
        <Kpi tone="navy" label="Vendas na loja B2B" value={sales ? compactMoney(sales.atual.valor) : "…"} d={sales && delta(sales.atual.valor, sales.anterior.valor)} sub={sales ? `${sales.atual.encomendas} encomendas · ${sales.atual.clientes} clientes` : b2bError || "A carregar…"} hint="Encomendas validadas, enviadas, confirmadas ou entregues (sem pendentes nem canceladas)." onClick={shop} />
        <Kpi tone="navy" label="Valor médio por encomenda" value={sales ? compactMoney(avg(sales.atual)) : "…"} d={sales && delta(avg(sales.atual), avg(sales.anterior))} sub={b2b ? `${b2b.clientes_loja.com_encomenda} de ${b2b.clientes_loja.ativos} clientes da loja encomendaram` : ""} />
        <Kpi tone="green" label="Negócios ganhos" value={m ? compactMoney(m.current.wonValue) : "…"} d={m && delta(m.current.wonValue, m.previous.wonValue)} sub={m ? `${m.current.won} ganhos · ${m.current.lost} perdidos` : ""} onClick={() => navigate("Oportunidades", { status: "won" })} />
        <Kpi tone="green" label="Taxa de conversão" value={m ? percent(m.current.conversion) : "…"} d={m && deltaPoints(m.current.conversion, m.previous.conversion)} sub={m?.current.cycleDays !== null && m ? `ciclo médio de ${m.current.cycleDays} dias` : "ganhos ÷ negócios decididos"} />
        <Kpi tone="blue" label="Pipeline em aberto" value={m ? compactMoney(m.pipeline.value) : "…"} sub={m ? `${compactMoney(m.pipeline.weighted)} ponderado · ${m.pipeline.count} oportunidades` : ""} hint="Ponderado = valor × probabilidade da fase." onClick={() => navigate("Oportunidades", { status: "open" })} />
        <Kpi tone="blue" label="Novas oportunidades" value={m ? nf.format(m.current.created) : "…"} d={m && delta(m.current.created, m.previous.created)} sub={m ? `${compactMoney(m.current.createdValue)} em potencial` : ""} />
        <Kpi tone="amber" label="Propostas enviadas" value={m || b2b ? nf.format(proposalsSent) : "…"} d={m && delta(m.current.proposalsSent, m.previous.proposalsSent)} sub={`${(m?.current.proposalsAccepted ?? 0) + (b2b?.propostas.aceites ?? 0)} aceites · ${compactMoney((m?.current.proposalsAcceptedValue ?? 0) + (b2b?.propostas.valor_aceite ?? 0))}`} hint="Propostas do CRM e da loja B2B. A variação compara só as do CRM." />
        <Kpi tone="amber" label="Visitas a clientes" value={m ? nf.format(m.current.visits) : "…"} d={m && delta(m.current.visits, m.previous.visits)} sub={m ? `${m.current.clientsVisited} clientes · ${m.current.calls} chamadas · ${m.current.emails} emails` : ""} onClick={() => navigate("Visitas", { from: range.from })} />
      </section>

      <div className="co-grid">
        <section className="card co-wide">
          <div className="card-head"><h2>Evolução das vendas na loja</h2><span className="co-muted">Últimos 12 meses</span></div>
          {!b2b ? <div className="useful-empty">{b2bError || "A carregar vendas…"}</div> : (
            <>
              <div className="co-months">
                {monthly.map((x) => (
                  <div key={x.mes} className={x.mes === thisMonth ? "current" : ""} title={`${monthLabel(x.mes)}: ${euro(x.valor)} em ${x.encomendas} encomendas`}>
                    <small>{x.valor ? compactMoney(x.valor).replace(" €", "") : ""}</small>
                    <i style={{ height: `${(x.valor / monthlyMax) * 100}%` }} />
                    <span>{monthLabel(x.mes)}</span>
                  </div>
                ))}
              </div>
              <p className="co-note">Total dos 12 meses: <b>{euro(monthly.reduce((s, x) => s + x.valor, 0))}</b> em {nf.format(monthly.reduce((s, x) => s + x.encomendas, 0))} encomendas.</p>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Previsão de fecho</h2><span className="co-muted">Pela data prevista</span></div>
          {!m ? <div className="useful-empty">A carregar…</div> : (
            <>
              {m.forecast.months.map((x) => (
                <div className="co-bar-row" key={x.key}>
                  <span>{x.label}</span>
                  <div><i style={{ width: `${(x.value / forecastMax) * 100}%` }} /><i className="weighted" style={{ width: `${(x.weighted / forecastMax) * 100}%` }} /></div>
                  <strong>{compactMoney(x.weighted)}</strong>
                </div>
              ))}
              <div className="legend dashboard-legend"><span><i className="dot blue" />Valor total</span><span><i className="dot green" />Ponderado (o que se espera fechar)</span></div>
              {(m.forecast.overdue > 0 || m.forecast.noDate > 0) && <p className="co-note">{m.forecast.overdue > 0 && <>{m.forecast.overdue} com data já ultrapassada. </>}{m.forecast.noDate > 0 && <>{m.forecast.noDate} sem data de fecho prevista.</>}</p>}
            </>
          )}
        </section>

        <section className="card co-wide">
          <div className="card-head"><h2>Funil de vendas</h2><button onClick={() => navigate("Oportunidades", { status: "open" })}>Ver oportunidades →</button></div>
          {!m ? <div className="useful-empty">A carregar…</div> : !m.funnel.length ? <div className="useful-empty">Nenhuma oportunidade em aberto.<button onClick={() => navigate("Oportunidades", { new: "1" })}>＋ Nova oportunidade</button></div> : (
            <div className="co-funnel">
              {m.funnel.map((s) => (
                <button key={s.stage} onClick={() => navigate("Oportunidades", { stage: s.stage })}>
                  <span>{s.stage}</span>
                  <div><i style={{ width: `${Math.max(3, (s.value / funnelMax) * 100)}%` }} /></div>
                  <strong>{compactMoney(s.value)}</strong>
                  <small>{s.count} {s.count === 1 ? "negócio" : "negócios"}{s.stale ? ` · ${s.stale} parado${s.stale > 1 ? "s" : ""}` : ""}</small>
                </button>
              ))}
            </div>
          )}
          {m && m.current.lossReasons.length > 0 && <p className="co-note">Porque perdemos neste período: {m.current.lossReasons.map(([r, n]) => `${r} (${n})`).join(", ")}.</p>}
        </section>

        <section className="card">
          <div className="card-head"><h2>Vendas por marca</h2><span className="co-muted">{range.label}</span></div>
          {!b2b ? <div className="useful-empty">{b2bError || "A carregar…"}</div> : !b2b.marcas.length ? <div className="useful-empty">Sem encomendas da loja neste período.</div> : (
            <ol className="co-rank">
              {b2b.marcas.map((x) => { const d = delta(x.valor, x.anterior); return (
                <li key={x.marca}><span>{x.marca}</span><b style={{ width: `${(x.valor / brandTotal) * 100}%` }} /><strong>{compactMoney(x.valor)}</strong><em className={`co-delta ${d.tone}`}>{Math.round((x.valor / brandTotal) * 100)}% · {d.text}</em></li>
              ); })}
            </ol>
          )}
        </section>

        <section className="card co-wide">
          <div className="card-head"><h2>Melhores clientes</h2><span className="co-muted">Compras na loja · {range.label.toLowerCase()}</span></div>
          {!b2b ? <div className="useful-empty">{b2bError || "A carregar…"}</div> : !b2b.clientes.length ? <div className="useful-empty">Sem encomendas da loja neste período.</div> : (
            <div className="co-table">
              <div className="co-th"><span>Cliente</span><span>Compras</span><span>Encomendas</span><span>vs anterior</span></div>
              {b2b.clientes.map((c) => { const d = delta(c.valor, c.anterior); return (
                <button key={c.nome} onClick={() => openCrmClient(c.crm_client_id)} disabled={!c.crm_client_id || !clientById.has(c.crm_client_id)}>
                  <strong>{c.nome}</strong><span>{euro(c.valor)}</span><span>{c.encomendas}</span><em className={`co-delta ${d.tone}`}>{d.text}</em>
                </button>
              ); })}
            </div>
          )}
        </section>

        <section className="card" id="co-reativar">
          <div className="card-head"><h2>Negócios mais quentes</h2><span className="co-muted">Valor × probabilidade</span></div>
          {!m?.hot.length ? <div className="useful-empty">Sem negócios em aberto.</div> : m.hot.map((o) => (
            <button className="dashboard-line co-line" key={o.id} onClick={() => navigate("Oportunidades", { opportunity: o.id })}>
              <time>{o.stage} · {o.probability}%</time><strong>{o.client}</strong><span>{o.title} · {euro(o.value)}</span>
            </button>
          ))}
          <h3 className="co-subhead">Clientes a reativar</h3>
          {!b2b ? <div className="useful-empty">{b2bError || "A carregar…"}</div> : !b2b.sem_encomenda.length ? <div className="useful-empty">Todos os clientes da loja encomendaram nos últimos 60 dias.</div> : b2b.sem_encomenda.map((c) => (
            <button className="dashboard-line co-line" key={c.nome} onClick={() => openCrmClient(c.crm_client_id)}>
              <time>Última encomenda há {daysAgo(c.ultima)} dias</time><strong>{c.nome}</strong><span>{euro(c.historico)} comprados no total</span>
            </button>
          ))}
        </section>

        {(currentUser.role === "admin" || (m?.team.length ?? 0) > 0) && (
          <section className="card co-full">
            <div className="card-head"><h2>Desempenho da equipa</h2><span className="co-muted">{range.label} · ordenado por negócios ganhos</span></div>
            {!m ? <div className="useful-empty">A carregar…</div> : (
              <div className="co-table co-team">
                <div className="co-th"><span>Comercial</span><span>Visitas</span><span>Chamadas</span><span>Emails</span><span>Propostas</span><span>Ganhos</span><span>Conversão</span><span>Pipeline</span><span>Parados</span></div>
                {m.team.map((t) => (
                  <button key={t.id} onClick={() => currentUser.role === "admin" && setOwner(owner === t.id ? "all" : t.id)} title={currentUser.role === "admin" ? (owner === t.id ? "Ver toda a equipa" : `Ver só ${t.name}`) : undefined}>
                    <strong>{t.name}</strong><span>{t.visits}</span><span>{t.calls}</span><span>{t.emails}</span><span>{t.proposals}</span><span>{compactMoney(t.wonValue)}</span><span>{percent(t.conversion)}</span><span>{compactMoney(t.pipeline)} <small>({t.openCount})</small></span><span className={t.stale ? "warn" : ""}>{t.stale}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {currentUser.role === "admin" && <div className="co-web"><WebVisits session={session} /></div>}
    </div>
  );
}
