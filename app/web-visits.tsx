"use client";
// Dashboard: acessos ao site e à loja B2B, e marcas mais vistas na loja (só administradores).
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { lastDays } from "./friendly-date";

type SiteStats = { visitantes: number; paginas: number; visitantes_7d: number; clientes_com_sessao: number };
type Stats = {
  dias: number;
  desde: string | null;
  sites: Partial<Record<"site" | "b2b", SiteStats>>;
  por_dia: Array<{ site: "site" | "b2b"; dia: string; visitantes: number }>;
  marcas: Array<{ marca: string; visitantes: number; paginas: number }>;
};

const nf = new Intl.NumberFormat("pt-PT");

export default function WebVisits({ session }: { session: Session }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    fetch(`/api/b2b/visits?dias=${days}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? "Sem dados de visitas."); return body as Stats; })
      .then((s) => active && setStats(s))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Sem dados de visitas."));
    return () => { active = false; };
  }, [days, session.access_token]);

  const axis = lastDays(Math.min(days, 30));
  const series = (site: "site" | "b2b") => axis.map((d) => stats?.por_dia.find((x) => x.site === site && x.dia === d)?.visitantes ?? 0);
  const b2b = series("b2b"), site = series("site");
  const max = Math.max(1, ...b2b, ...site);
  const topMax = Math.max(1, ...(stats?.marcas ?? []).map((m) => m.visitantes));
  const card = (key: "site" | "b2b", label: string, hint: string) => {
    const s = stats?.sites[key];
    return (
      <div className="web-visits-kpi">
        <span>{label}</span>
        <strong>{nf.format(s?.visitantes ?? 0)}</strong>
        <small>visitantes · {nf.format(s?.paginas ?? 0)} páginas vistas</small>
        <small>{nf.format(s?.visitantes_7d ?? 0)} nos últimos 7 dias{key === "b2b" && s?.clientes_com_sessao ? ` · ${s.clientes_com_sessao} clientes com sessão` : ""}</small>
        {!s && <em>{hint}</em>}
      </div>
    );
  };

  return (
    <section className="card wide web-visits">
      <div className="card-head">
        <h2>Visitas ao site e à loja B2B</h2>
        <div className="period web-visits-period">
          {[7, 30, 90].map((n) => <button key={n} className={days === n ? "selected" : ""} onClick={() => setDays(n)}>{n} dias</button>)}
        </div>
      </div>
      {error ? <div className="useful-empty">{error}</div> : !stats ? <div className="useful-empty">A carregar visitas…</div> : (
        <>
          <div className="web-visits-kpis">
            {card("site", "Site representacoesfreixo.com", "Ainda sem registos: falta pôr o contador no site.")}
            {card("b2b", "Loja B2B", "Ainda sem registos.")}
          </div>
          <div className="web-visits-chart" aria-label="Visitantes por dia">
            {axis.map((d, i) => (
              <div key={d} title={`${d.slice(8)}/${d.slice(5, 7)}: site ${site[i]}, loja ${b2b[i]}`}>
                <i className="site" style={{ height: `${(site[i] / max) * 100}%` }} />
                <i className="b2b" style={{ height: `${(b2b[i] / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="legend dashboard-legend"><span><i className="dot blue" />Site</span><span><i className="dot green" />Loja B2B</span></div>
          <h3>Marcas mais vistas na loja</h3>
          {stats.marcas.length ? (
            <ol className="web-visits-brands">
              {stats.marcas.map((m) => (
                <li key={m.marca}>
                  <span>{m.marca}</span>
                  <b style={{ width: `${(m.visitantes / topMax) * 100}%` }} />
                  <em>{nf.format(m.visitantes)} visitantes</em>
                </li>
              ))}
            </ol>
          ) : <div className="useful-empty">Ainda não há visitas a páginas de marcas.</div>}
          <p className="subtitle">Sem contar a equipa. Um visitante é um browser; conta-se uma vez por página e por dia.{stats.desde ? ` Registos desde ${new Date(stats.desde).toLocaleDateString("pt-PT")}.` : ""}</p>
        </>
      )}
    </section>
  );
}
