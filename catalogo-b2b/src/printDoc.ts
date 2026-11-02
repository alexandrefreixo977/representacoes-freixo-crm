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
          (l) => `<tr class=line>
${anyImage ? `<td class=img>${l.imageUrl ? `<img src="${esc(abs(l.imageUrl))}" alt="">` : ""}</td>` : ""}
<td class=ref>${esc(l.reference)}</td><td>${esc(l.designation)}</td><td class=n>${esc(l.qty)} ${esc(l.unit)}</td>
${anyDiscount ? `<td class=n>${formatEur(l.listPrice)}</td><td class=n>${l.discounts.length ? formatDiscounts(l.discounts) : l.netPrice < l.listPrice ? "Especial" : "—"}</td>` : ""}
<td class=n>${formatEur(l.netPrice)}</td><td class=n><strong>${formatEur(l.total)}</strong></td></tr>`
        )
        .join("");
      const head = `<tr class=colhead>${anyImage ? "<th></th>" : ""}<th>Referência</th><th>Designação</th><th class=n>Qtd.</th>${anyDiscount ? "<th class=n>P. tabela</th><th class=n>Desc.</th>" : ""}<th class=n>P. unit.</th><th class=n>Total</th></tr>`;
      return `<tr class=blk><td colspan=${cols}><div class=mfr>
  ${m?.logoUrl ? `<img src="${esc(abs(m.logoUrl))}" alt="">` : ""}
  <div><span class=label>Fabricante</span><strong>${esc(m?.name ?? g.name)}</strong>${details.length ? `<div class=det>${details.map(esc).join(" &nbsp;·&nbsp; ")}</div>` : ""}</div>
</div></td></tr>
${head}${rows}
${d.groups.length > 1 ? `<tr class=sub><td colspan=${cols - 1} class=n>Subtotal ${esc(m?.name ?? g.name)}</td><td class=n><strong>${formatEur(subtotal)}</strong></td></tr>` : ""}
<tr class=gap><td colspan=${cols}></td></tr>`;
    })
    .join("");

  // Margens: a página não tem margem própria (@page margin 0) e o documento cria-as por dentro:
  // laterais com padding e, em cima e em baixo de cada página, com o cabeçalho/rodapé (vazios) repetidos da tabela do documento.
  // Tudo é uma só tabela, com uma linha por artigo, para o Chrome poder quebrar a página entre linhas e repetir esses espaços.
  // Assim as margens aparecem sempre, seja qual for a opção "Margens" escolhida na janela de impressão.
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>${esc(d.number)} · ${esc(d.client.name)}</title>
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font:9.5pt/1.45 Arial,"Helvetica Neue",Helvetica,sans-serif;color:#2b2b2d;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{padding:0 18mm}
@media screen{body{background:#e9e9ec;padding:24px 0}.sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.15)}}
table.doc{width:100%;border-collapse:collapse}
table.doc>thead{display:table-header-group}table.doc>tfoot{display:table-footer-group}
.sp-top td{height:16mm;padding:0}.sp-bot td{height:16mm;padding:0}
tr.blk>td{padding:0}
tr.gap>td{height:7mm;padding:0}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding-bottom:5mm;border-bottom:2px solid #d2b12b}
.top img{height:17mm;width:auto;display:block}
.dochead{text-align:right}
.dochead h1{font-size:17pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin:0 0 2mm;color:#2b2b2d}
.meta{display:inline-grid;grid-template-columns:auto auto;gap:1px 10px;font-size:9pt;text-align:left}
.meta span{color:#8a8d93;text-transform:uppercase;letter-spacing:.06em;font-size:7.5pt;align-self:center}
.meta b{font-size:10pt}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin:7mm 0 8mm}
.box{background:#f7f7f8;border-radius:2mm;padding:4mm 5mm;line-height:1.55}
.label{display:block;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#9a8320;margin-bottom:1.5mm}
.box strong{font-size:11pt;display:block;margin-bottom:.5mm}
.box .l{color:#55595f}
.mfr{display:flex;gap:4mm;align-items:center;padding:0 0 2.5mm}
tr.blk:has(.mfr),tr.colhead{break-after:avoid}
.mfr img{height:10mm;max-width:32mm;object-fit:contain}
.mfr strong{font-size:11pt}
.det{color:#6b6f75;font-size:8pt;margin-top:.5mm}
tr.colhead th{background:#3b3b3d;color:#fff;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:2.2mm 2mm}
tr.line td{border-bottom:1px solid #e6e6e8;padding:2mm;vertical-align:middle}
tr.line:nth-child(even) td{background:#fafafa}
td.img{width:12mm;padding:1mm 2mm !important}td.img img{width:10mm;height:10mm;object-fit:contain;display:block}
td.ref{font-weight:700;white-space:nowrap}
.n{text-align:right !important;white-space:nowrap}
tr.sub td{color:#55595f;padding:2.5mm 2mm 0}
tr{break-inside:avoid}
.total{display:flex;justify-content:flex-end;margin:0 0 6mm;break-inside:avoid}
.total div{min-width:75mm;background:#3b3b3d;color:#fff;border-radius:1.5mm;padding:3mm 5mm;display:flex;justify-content:space-between;gap:8mm;font-size:11pt}
.total div strong:last-child{color:#f1d35a}
.terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(40mm,1fr));gap:3mm;margin:0 0 5mm;break-inside:avoid}
.terms div{border-top:2px solid #d2b12b;padding:2mm 0 0}
.terms span{display:block;font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#8a8d93;margin-bottom:.5mm}
.notes{white-space:pre-wrap;background:#faf7ea;border-left:3px solid #d2b12b;padding:3mm 4mm;break-inside:avoid}
.notes .label{margin-bottom:1mm}
.foot{margin-top:10mm;font-size:7.5pt;color:#8a8d93;border-top:1px solid #e1e1e3;padding-top:2.5mm;display:flex;justify-content:space-between;gap:6mm}
</style></head><body><div class=sheet>
<table class=doc>
<thead><tr class=sp-top><td colspan=${cols}></td></tr></thead>
<tfoot><tr class=sp-bot><td colspan=${cols}></td></tr></tfoot>
<tbody><tr class=blk><td colspan=${cols}>
<div class=top><img src="${location.origin}/logo.png" alt="Representações Freixo"><div class=dochead><h1>${esc(d.title)}</h1>
<div class=meta><span>Número</span><b>${esc(d.number)}</b><span>Data</span><b>${esc(d.date)}</b></div></div></div>
<div class=parties>
<div class=box><span class=label>Cliente</span><strong>${esc(d.client.name)}</strong>${d.client.lines.map((l) => `<div class=l>${esc(l)}</div>`).join("")}</div>
<div class=box><span class=label>Emitido por</span><strong>Representações Freixo</strong>${d.freixo.map((l) => `<div class=l>${esc(l)}</div>`).join("")}</div>
</div>
</td></tr>
${groups}
<tr class=blk><td colspan=${cols}>
<div class=total><div><strong>Total s/ IVA</strong><strong>${formatEur(total)}</strong></div></div>
${d.terms?.length ? `<div class=terms>${d.terms.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>` : ""}
${d.notes ? `<div class=notes><span class=label>Observações</span>${esc(d.notes)}</div>` : ""}
<div class=foot><span>${esc(d.footNote)}</span><span>Representações Freixo · Viana do Castelo · representacoesfreixo.com</span></div>
</td></tr></tbody>
</table></div>
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
