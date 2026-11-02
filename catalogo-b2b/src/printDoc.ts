import { formatDiscounts, formatEur } from "./pricing";
import type { Manufacturer } from "./types";

/**
 * Documento para imprimir / guardar em PDF (propostas e notas de encomenda), com o mesmo aspeto:
 * cabeçalho com o logótipo, cliente e Representações Freixo, e os artigos agrupados por fabricante,
 * cada grupo com os dados desse fabricante e o subtotal.
 */

export type DocLine = {
  imageUrl?: string | null;
  reference: string;
  designation: string;
  qty: number;
  unit: string;
  listPrice: number;
  discounts: number[];
  netPrice: number;
  total: number;
};

export type DocGroup = {
  /** Fabricante dos artigos (com os dados da ficha). Sem ficha: só o nome. */
  manufacturer?: Manufacturer | null;
  name: string;
  lines: DocLine[];
};

export type DocSpec = {
  title: string;
  number: string;
  date: string;
  client: { name: string; lines: string[] };
  /** Linhas do bloco Representações Freixo (comercial, email…). */
  freixo: string[];
  groups: DocGroup[];
  terms?: [string, string][];
  notes?: string | null;
  footNote: string;
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const round2 = (n: number) => Math.round(n * 100) / 100;
const abs = (url: string) => {
  try {
    return new URL(url, location.origin).href;
  } catch {
    return url;
  }
};

/** Dados do fabricante: razão social, NIF, morada, país, telefone e site (só os que existem). O email de encomendas fica de fora: o contacto é a Freixo. */
export function manufacturerDetails(m?: Manufacturer | null): string[] {
  if (!m) return [];
  const site = m.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return [
    m.legalName && m.legalName !== m.name ? m.legalName : "",
    m.nif ? `NIF/VAT ${m.nif}` : "",
    [m.address, m.country].filter(Boolean).join(" · "),
    [m.phone, site].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

export function documentHtml(d: DocSpec): string {
  const anyDiscount = d.groups.some((g) => g.lines.some((l) => l.discounts.length || l.netPrice < l.listPrice));
  const anyImage = d.groups.some((g) => g.lines.some((l) => l.imageUrl));
  const cols = 5 + (anyDiscount ? 2 : 0) + (anyImage ? 1 : 0);
  const total = round2(d.groups.reduce((s, g) => s + g.lines.reduce((t, l) => t + l.total, 0), 0));

  const groups = d.groups
    .map((g) => {
      const m = g.manufacturer;
      const details = manufacturerDetails(m);
      const subtotal = round2(g.lines.reduce((t, l) => t + l.total, 0));
      const rows = g.lines
        .map(
          (l) => `<tr>
${anyImage ? `<td class=img>${l.imageUrl ? `<img src="${esc(abs(l.imageUrl))}" alt="">` : ""}</td>` : ""}
<td class=ref>${esc(l.reference)}</td><td>${esc(l.designation)}</td><td class=n>${esc(l.qty)} ${esc(l.unit)}</td>
${anyDiscount ? `<td class=n>${formatEur(l.listPrice)}</td><td class=n>${l.discounts.length ? formatDiscounts(l.discounts) : l.netPrice < l.listPrice ? "Especial" : "—"}</td>` : ""}
<td class=n>${formatEur(l.netPrice)}</td><td class=n><strong>${formatEur(l.total)}</strong></td></tr>`
        )
        .join("");
      return `<section class=group>
<div class=mfr>
  ${m?.logoUrl ? `<img src="${esc(abs(m.logoUrl))}" alt="">` : ""}
  <div><span class=label>Fabricante</span><strong>${esc(m?.name ?? g.name)}</strong>${details.length ? `<div class=det>${details.map(esc).join("<br>")}</div>` : ""}</div>
</div>
<table>
<thead><tr>${anyImage ? "<th></th>" : ""}<th>Referência</th><th>Designação</th><th class=n>Qtd.</th>${anyDiscount ? "<th class=n>P. tabela</th><th class=n>Desc.</th>" : ""}<th class=n>P. unit.</th><th class=n>Total</th></tr></thead>
<tbody>${rows}</tbody>
${d.groups.length > 1 ? `<tfoot><tr><td colspan=${cols - 1} class=n>Subtotal ${esc(m?.name ?? g.name)}</td><td class=n><strong>${formatEur(subtotal)}</strong></td></tr></tfoot>` : ""}
</table>
</section>`;
    })
    .join("");

  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(d.number)} · ${esc(d.client.name)}</title>
<style>
@page{size:A4;margin:12mm 12mm 14mm}
*{box-sizing:border-box}
body{font:11.5px/1.45 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#2b2b2d;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media screen{body{max-width:210mm;margin:0 auto;padding:12mm;background:#fff}}
.top{display:flex;justify-content:space-between;align-items:center;gap:24px;padding-bottom:12px;border-bottom:3px solid #d2b12b}
.top img{height:56px;width:auto;display:block}
.doc{text-align:right}.doc h1{font-size:19px;text-transform:uppercase;margin:0;color:#3b3b3d;letter-spacing:.08em}.doc .num{font-size:14px;font-weight:700}.doc .date{color:#6b6f75}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 18px}
.box{border:1px solid #e1e1e3;border-radius:6px;padding:10px 12px}
.label{display:block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#9a8320;margin-bottom:3px}
.box strong{font-size:13px}
.group{margin-bottom:16px;break-inside:auto}
.mfr{display:flex;gap:12px;align-items:center;background:#f6f4ec;border-left:4px solid #d2b12b;border-radius:4px;padding:8px 12px;break-after:avoid}
.mfr img{height:34px;max-width:110px;object-fit:contain;background:#fff;border-radius:4px;padding:2px}
.mfr strong{font-size:13px}.det{color:#55595f;font-size:10.5px;margin-top:1px}
table{width:100%;border-collapse:collapse;margin-top:4px}
thead{display:table-header-group}
th{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b6f75;text-align:left;border-bottom:1.5px solid #3b3b3d;padding:6px 5px}
td{border-bottom:1px solid #ececee;padding:5px;vertical-align:middle}
td.img{width:40px}td.img img{width:36px;height:36px;object-fit:contain;display:block}
td.ref{font-weight:600;white-space:nowrap}
.n{text-align:right;white-space:nowrap}
tfoot td{border:0;color:#55595f;padding-top:6px}
tr{break-inside:avoid}
.total{display:flex;justify-content:flex-end;margin:6px 0 4px}
.total div{min-width:260px;border-top:2px solid #3b3b3d;padding-top:8px;display:flex;justify-content:space-between;font-size:14px}
.terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:16px 0}
.terms div{border:1px solid #e1e1e3;border-radius:6px;padding:7px 10px}.terms span{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b6f75}
.notes{white-space:pre-wrap;border-left:3px solid #d2b12b;padding:7px 12px;background:#faf7ea;break-inside:avoid}
.foot{margin-top:24px;font-size:9.5px;color:#6b6f75;border-top:1px solid #e1e1e3;padding-top:7px;display:flex;justify-content:space-between;gap:16px}
</style></head><body>
<div class=top><img src="${location.origin}/logo.png" alt="Representações Freixo"><div class=doc><h1>${esc(d.title)}</h1><div class=num>${esc(d.number)}</div><div class=date>${esc(d.date)}</div></div></div>
<div class=parties>
<div class=box><span class=label>Cliente</span><strong>${esc(d.client.name)}</strong>${d.client.lines.length ? `<br>${d.client.lines.map(esc).join("<br>")}` : ""}</div>
<div class=box><span class=label>Representações Freixo</span>${d.freixo.map(esc).join("<br>")}</div>
</div>
${groups}
<div class=total><div><strong>Total sem IVA</strong><strong>${formatEur(total)}</strong></div></div>
${d.terms?.length ? `<div class=terms>${d.terms.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>` : ""}
${d.notes ? `<div class=notes>${esc(d.notes)}</div>` : ""}
<div class=foot><span>${esc(d.footNote)}</span><span>Representações Freixo · representacoesfreixo.com</span></div>
<script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`;
}

export function openDocument(d: DocSpec) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(documentHtml(d));
  w.document.close();
  return true;
}

/** Bloco Representações Freixo: morada, site e o comercial (sem repetir o email). */
export function freixoLines(person?: string | null, email?: string | null): string[] {
  const who = person && person !== email ? person : null;
  return ["Viana do Castelo · Portugal", who ? `Comercial: ${who}` : "", email ?? ""].filter(Boolean);
}
