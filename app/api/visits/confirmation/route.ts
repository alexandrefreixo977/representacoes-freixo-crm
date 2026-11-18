// Envia ao cliente o email de confirmação (ou de reagendamento) de uma visita marcada no CRM.
// Sai da caixa de quem marcou a visita, com a sua assinatura e um convite .ics, e fica no histórico do cliente.
import { mailSession, mailError, requireMailPermission, applicationToken, json, MailError } from "../../mail/server";
import { userSignature } from "../../mail/signature";
import { buildVisitConfirmation, clientAddress, visitRecipient, type VisitConfirmationMode } from "../../../visit-confirmation";

const toBase64 = (text: string) => { const bytes = new TextEncoder().encode(text); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };

export async function POST(request: Request): Promise<Response> {
  try {
    const { db, user } = await mailSession(request);
    await requireMailPermission(db);
    const body = await request.json().catch(() => ({})) as { activityId?: string; mode?: VisitConfirmationMode };
    if (!body.activityId) throw new MailError(400, "Visita em falta.");
    const mode: VisitConfirmationMode = body.mode === "reschedule" ? "reschedule" : "confirm";

    const visit = await db.from("activities").select("id,kind,title,status,start_at,end_at,has_time,schedule_timezone,client_id,contact_id,assigned_to").eq("id", body.activityId).single();
    if (visit.error || !visit.data) throw new MailError(404, "Visita não encontrada.");
    const v = visit.data;
    if (v.kind !== "visit") throw new MailError(400, "Só as visitas enviam confirmação ao cliente.");
    if (["cancelled", "canceled", "completed", "archived"].includes(String(v.status))) throw new MailError(409, "Esta visita não está marcada; a confirmação não foi enviada.");
    if (!v.start_at || v.has_time === false) throw new MailError(400, "Indique a hora da visita para enviar a confirmação ao cliente.");
    if (Date.parse(v.start_at) < Date.now() - 15 * 60 * 1000) throw new MailError(409, "A visita já passou; a confirmação não foi enviada.");

    const [client, contacts, contact, assignee] = await Promise.all([
      db.from("clients").select("id,trade_name,email,address,postal_code,city").eq("id", v.client_id).single(),
      db.from("client_contacts").select("first_name,last_name,email,is_primary,active").eq("client_id", v.client_id),
      v.contact_id ? db.from("client_contacts").select("first_name,last_name,email").eq("id", v.contact_id).single() : Promise.resolve({ data: null, error: null }),
      db.from("profiles").select("full_name,signature_name,signature_email,signature_phone,email").eq("id", v.assigned_to ?? user.id).single(),
    ]);
    if (client.error || !client.data) throw new MailError(403, "Cliente não autorizado.");
    const recipient = visitRecipient(contact.data, contacts.data ?? [], client.data.email);
    if (!recipient) return json({ ok: false, skipped: true, reason: "O cliente não tem email registado; a confirmação não foi enviada." });

    // A visita é do comercial responsável; se for outra pessoa a marcar, o email sai da caixa de quem marca mas com o contacto do responsável.
    const me = await db.from("profiles").select("full_name,signature_name,signature_phone").eq("id", user.id).single();
    const owner = assignee.data ?? me.data;
    const commercialName = owner?.signature_name || owner?.full_name || me.data?.full_name || user.email;
    const commercialEmail = (assignee.data && (assignee.data.signature_email || assignee.data.email)) || user.email;
    const commercialPhone = owner?.signature_phone || null;

    const origin = new URL(request.url).origin;
    const signature = await userSignature(db, user, origin);
    const mail = buildVisitConfirmation({
      mode, clientName: client.data.trade_name, contactName: recipient.name, startAt: v.start_at, endAt: v.end_at,
      timezone: v.schedule_timezone || "Europe/Lisbon", visitType: v.title, address: clientAddress(client.data),
      commercialName, commercialEmail, commercialPhone, activityId: v.id, logoUrl: `${origin}/email-signature-logo.png`, signatureHtml: signature.html,
    });

    const cc = commercialEmail.toLowerCase() !== user.email.toLowerCase() ? [{ emailAddress: { address: commercialEmail } }] : [];
    const token = await applicationToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.email)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: mail.subject,
          body: { contentType: "HTML", content: mail.html },
          toRecipients: [{ emailAddress: { address: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) } }],
          ccRecipients: cc,
          replyTo: [{ emailAddress: { address: commercialEmail } }],
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "visita-representacoes-freixo.ics", contentType: "text/calendar; charset=utf-8; method=PUBLISH", contentBytes: toBase64(mail.ics) }],
        },
        saveToSentItems: true,
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new MailError(502, detail?.error?.message || "A Microsoft recusou o envio da confirmação.");
    }

    // Histórico do cliente (não bloqueia: o email já saiu).
    let warning: string | undefined;
    try {
      const sentAt = new Date().toISOString();
      const saved = await db.from("emails").insert({ client_id: v.client_id, sender_id: user.id, subject: mail.subject, body_html: mail.html, status: "sent", sent_at: sentAt }).select("id").single();
      if (saved.error || !saved.data) throw saved.error;
      await db.from("email_recipients").insert([{ email_id: saved.data.id, address: recipient.email, recipient_type: "to" }, ...cc.map(x => ({ email_id: saved.data.id, address: x.emailAddress.address, recipient_type: "cc" }))]);
      const history = await db.from("activities").insert({ client_id: v.client_id, kind: "email", interaction_type: "Email", actor_id: user.id, entity_id: saved.data.id, subject: mail.subject, summary: `Email enviado: ${mail.subject}`, description: mail.text, result: `Para ${recipient.email}`, status: "sent", occurred_at: sentAt });
      if (history.error) throw history.error;
    } catch { warning = "Confirmação enviada, mas não ficou registada no histórico do cliente."; }

    return json({ ok: true, to: recipient.email, ...(warning ? { warning } : {}) });
  } catch (error) {
    return mailError(error);
  }
}
