import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComposedEmail } from "./email-composer";

export type MailClient = { id?: string; name: string; email: string; contacts?: { name: string; email: string }[] };
export function sentClientId(clients: MailClient[], address: string) {
  const normalized = address.trim().toLowerCase();
  const ids = [...new Set(clients.filter(client => [client.email, ...(client.contacts ?? []).map(contact => contact.email)].some(email => email?.trim().toLowerCase() === normalized)).map(client => client.id).filter(Boolean))];
  return ids.length === 1 ? ids[0]! : null;
}
// Only called after a new outgoing message has been accepted by send-email.
// Reading, replying and forwarding Outlook messages never use this commercial log.
export async function recordSentMail(db: SupabaseClient, senderId: string, email: ComposedEmail, clientId: string | null) {
  const sentAt = new Date().toISOString();
  const saved = await db.from("emails").insert({ client_id: clientId, sender_id: senderId, subject: email.subject, body_html: email.bodyHtml, status: "sent", sent_at: sentAt }).select("id").single();
  if (saved.error || !saved.data) throw new Error("O registo do envio não foi guardado.");
  const recipients = [
    { email_id: saved.data.id, address: email.to, recipient_type: "to" },
    ...email.cc.map(address => ({ email_id: saved.data.id, address, recipient_type: "cc" })),
    ...email.bcc.map(address => ({ email_id: saved.data.id, address, recipient_type: "bcc" })),
  ];
  const recorded = await db.from("email_recipients").insert(recipients);
  if (recorded.error) throw new Error("O envio foi registado, mas os destinatários não foram guardados.");
  if (clientId) {
    const history = await db.from("activities").insert({ client_id: clientId, kind: "email", interaction_type: "Email", actor_id: senderId, entity_id: saved.data.id, subject: email.subject, summary: `Email enviado: ${email.subject}`, description: email.bodyText + (email.attachments.length ? `\n\nAnexos: ${email.attachments.map(file => file.name).join(", ")}` : ""), result: `Para ${email.to}`, status: "sent", occurred_at: sentAt });
    if (history.error) throw new Error("O envio foi registado, mas não foi possível atualizar o histórico do cliente.");
  }
}
