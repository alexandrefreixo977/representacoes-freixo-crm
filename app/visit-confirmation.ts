// Email de confirmação de visita enviado ao cliente quando uma visita é marcada (ou reagendada) no CRM.
// Funções puras: o envio está em app/api/visits/confirmation/route.ts.
import { COMPANY_EMAIL_CONFIG } from "./company-config.ts";

export type VisitConfirmationMode = "confirm" | "reschedule";
export type VisitConfirmationInput = {
  mode: VisitConfirmationMode;
  clientName: string;
  contactName?: string | null;
  startAt: string;
  endAt?: string | null;
  timezone: string;
  visitType?: string | null;
  address?: string | null;
  commercialName: string;
  commercialEmail: string;
  commercialPhone?: string | null;
  activityId: string;
  logoUrl?: string;
  signatureHtml?: string;
};

// Só estes motivos seguem para o cliente; o assunto livre da agenda pode ter notas internas.
const PUBLIC_TYPES = ["Visita comercial", "Visita técnica", "Demonstração", "Apresentação"];
export const publicVisitType = (title?: string | null) => PUBLIC_TYPES.find(t => t.toLowerCase() === String(title ?? "").trim().toLowerCase()) ?? "Visita comercial";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name?: string | null) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

export function visitWhen(startAt: string, endAt: string | null | undefined, timezone: string) {
  const start = new Date(startAt);
  const date = new Intl.DateTimeFormat("pt-PT", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat("pt-PT", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(d);
  const end = endAt ? new Date(endAt) : null;
  return { date: date.charAt(0).toUpperCase() + date.slice(1), time: end && end > start ? `${time(start)} – ${time(end)}` : time(start) };
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Convite de calendário (.ics) para o cliente juntar a visita à sua agenda com um clique.
export function visitIcs(input: VisitConfirmationInput, sequence = 0) {
  const start = new Date(input.startAt);
  const end = input.endAt && new Date(input.endAt) > start ? new Date(input.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const type = publicVisitType(input.visitType);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Representacoes Freixo//CRM//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:visita-${input.activityId}@representacoesfreixo.com`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`${type} · Representações Freixo`)}`,
    `DESCRIPTION:${icsText(`${type} de ${input.commercialName} (Representações Freixo).\nContacto: ${input.commercialEmail}${input.commercialPhone ? ` · ${input.commercialPhone}` : ""}`)}`,
    ...(input.address ? [`LOCATION:${icsText(input.address)}`] : []),
    `ORGANIZER;CN=${icsText(input.commercialName)}:mailto:${input.commercialEmail}`,
    "STATUS:CONFIRMED", "TRANSP:OPAQUE",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${icsText(type)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

export function buildVisitConfirmation(input: VisitConfirmationInput) {
  const { date, time } = visitWhen(input.startAt, input.endAt, input.timezone);
  const type = publicVisitType(input.visitType);
  const reschedule = input.mode === "reschedule";
  const greetingName = firstName(input.contactName);
  const greeting = greetingName ? `Olá ${greetingName},` : "Caro(a) Cliente,";
  const when = `${date.charAt(0).toLowerCase()}${date.slice(1)}, ${time.split(" ")[0]}`;
  const subject = reschedule
    ? `Visita reagendada · ${when} · Representações Freixo`
    : `Confirmação de visita · ${when} · Representações Freixo`;
  const intro = reschedule
    ? `Informamos que a visita da Representações Freixo à <strong>${esc(input.clientName)}</strong> foi reagendada. Seguem os novos detalhes:`
    : `Obrigado pela disponibilidade. Confirmamos a visita da Representações Freixo à <strong>${esc(input.clientName)}</strong>, com os seguintes detalhes:`;
  const introText = reschedule
    ? `Informamos que a visita da Representações Freixo à ${input.clientName} foi reagendada. Seguem os novos detalhes:`
    : `Obrigado pela disponibilidade. Confirmamos a visita da Representações Freixo à ${input.clientName}, com os seguintes detalhes:`;
  const contactLine = [input.commercialEmail, input.commercialPhone].filter(Boolean).join(" · ");
  const rows: [string, string][] = [
    ["Data", date],
    ["Hora", time],
    ["Local", input.address || "Nas vossas instalações"],
    ["Motivo", type],
    ["Comercial", input.commercialName],
    ["Contacto", contactLine],
  ];
  const row = ([label, value]: [string, string]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #ece8dd;font:600 12px Arial,Helvetica,sans-serif;color:#8a8d93;text-transform:uppercase;letter-spacing:.06em;width:110px;vertical-align:top">${label}</td><td style="padding:9px 0;border-bottom:1px solid #ece8dd;font:15px Arial,Helvetica,sans-serif;color:#24272d;vertical-align:top">${esc(value)}</td></tr>`;
  const p = (html: string) => `<p style="margin:0 0 14px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#2d3035">${html}</p>`;
  const html = `<!doctype html><html lang="pt-PT"><body style="margin:0;padding:0;background:#f6f4ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e3dfd4;border-radius:10px;overflow:hidden">
<tr><td style="background:#ffffff;padding:20px 28px 16px">${input.logoUrl ? `<img src="${esc(input.logoUrl)}" alt="Representações Freixo" height="44" style="display:block;height:44px;border:0">` : `<span style="font:bold 18px Arial,Helvetica,sans-serif;color:#24272d">Representações Freixo</span>`}</td></tr>
<tr><td style="height:4px;background:#d9b51f;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 6px;font:600 12px Arial,Helvetica,sans-serif;letter-spacing:.12em;color:#ad7c18;text-transform:uppercase">${reschedule ? "Visita reagendada" : "Visita confirmada"}</p>
<h1 style="margin:0 0 18px;font:bold 22px/1.3 Arial,Helvetica,sans-serif;color:#24272d">${esc(date)}, ${esc(time)}</h1>
${p(esc(greeting))}${p(intro)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border-top:1px solid #ece8dd">${rows.map(row).join("")}</table>
${p("Juntamos um convite de calendário (ficheiro <strong>.ics</strong>) para adicionar a visita à sua agenda com um clique.")}
${p("Se precisar de alterar a data ou a hora, basta responder a este email ou contactar-nos diretamente. Teremos todo o gosto em encontrar o melhor momento.")}
${p("Até breve,")}
</td></tr>
${input.signatureHtml ? `<tr><td style="padding:0 28px 24px">${input.signatureHtml}</td></tr>` : `<tr><td style="padding:0 28px 24px">${p(`<strong>${esc(input.commercialName)}</strong><br>Representações Freixo`)}</td></tr>`}
<tr><td style="background:#f6f4ee;padding:14px 28px;font:11px/1.5 Arial,Helvetica,sans-serif;color:#8a8d93;text-align:center">${COMPANY_EMAIL_CONFIG.activityLine}<br><a href="${COMPANY_EMAIL_CONFIG.websiteUrl}" style="color:#ad7c18;text-decoration:none">${COMPANY_EMAIL_CONFIG.website}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [greeting, "", introText, "", ...rows.map(([l, v]) => `${l}: ${v}`), "", "Juntamos um convite de calendário (.ics) para adicionar a visita à sua agenda.", "Se precisar de alterar a data ou a hora, basta responder a este email.", "", "Até breve,", input.commercialName, "Representações Freixo"].join("\n");
  return { subject, html, text, ics: visitIcs(input, reschedule ? Math.floor(Date.now() / 1000) : 0) };
}

// Morada do cliente numa só linha, para o campo "Local".
export const clientAddress = (c: { address?: string | null; postal_code?: string | null; city?: string | null }) =>
  [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].map(x => String(x ?? "").trim()).filter(Boolean).join(", ");

// Destinatário: contacto escolhido na visita, depois o contacto principal, depois o email geral do cliente.
export function visitRecipient(contact: { email?: string | null; first_name?: string | null; last_name?: string | null } | null, contacts: { email?: string | null; is_primary?: boolean | null; first_name?: string | null; last_name?: string | null; active?: boolean | null }[], clientEmail?: string | null) {
  const valid = (e?: string | null) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  const name = (c: { first_name?: string | null; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(" ");
  if (contact && valid(contact.email)) return { email: contact.email!.trim(), name: name(contact) };
  const active = contacts.filter(c => c.active !== false && valid(c.email));
  const primary = active.find(c => c.is_primary) ?? (active.length === 1 ? active[0] : null);
  if (primary) return { email: primary.email!.trim(), name: name(primary) };
  if (valid(clientEmail)) return { email: clientEmail!.trim(), name: "" };
  return null;
}
