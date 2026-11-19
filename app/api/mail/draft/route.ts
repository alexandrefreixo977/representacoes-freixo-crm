import { applicationToken, json, MailError, mailError, mailSession, readGraph, requireMailPermission } from "../server";
import { validGraphId } from "../../../mail-content";
import { normalizeAddress, validAddress, validateRecipients, type RecipientLists } from "../../../mail-recipients";
import { combineDraftBody, sanitizeComposeHtml, splitDraftBody } from "../../../mail-html";
import { draftAttachments, graphWrite, requireDraft } from "../graph-write";
import { boundedJson } from "../body";
export const dynamic = "force-dynamic";

const MODES = { new: "", reply: "createReply", replyAll: "createReplyAll", forward: "createForward" } as const;
type Mode = keyof typeof MODES;
const parties = (values: string[]) => values.map(address => ({ emailAddress: { address } }));

export async function GET(request: Request) {
  try {
    const { user } = await mailSession(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!validGraphId(id)) throw new MailError(400, "Rascunho inválido.");
    const token = await applicationToken();
    const [message, attachments] = await Promise.all([
      readGraph(token, user.email, `/messages/${encodeURIComponent(id)}?$select=id,subject,body,toRecipients,ccRecipients,bccRecipients,importance,isDraft,conversationId`),
      draftAttachments(token, user.email, id),
    ]);
    if (!message.isDraft) throw new MailError(409, "Esta mensagem já foi enviada e não pode ser editada.");
    const addresses = (list?: { emailAddress?: { address?: string } }[]) => (list ?? []).map(item => item.emailAddress?.address || "").filter(Boolean).map(normalizeAddress);
    const { own, quote } = message.body?.contentType?.toLowerCase() === "html" ? splitDraftBody(message.body.content) : { own: String(message.body?.content || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"), quote: "" };
    return json({ id: message.id, subject: message.subject || "", to: addresses(message.toRecipients), cc: addresses(message.ccRecipients), bcc: addresses(message.bccRecipients), importance: message.importance || "normal", html: sanitizeComposeHtml(own), quoteHtml: quote, attachments });
  } catch (error) { return mailError(error); }
}

export async function POST(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    const body = await boundedJson(request, 6_000_000, "A mensagem é demasiado grande. Envie as imagens como anexo.");
    const mode = body?.mode as Mode;
    if (!(mode in MODES)) throw new MailError(400, "Tipo de mensagem inválido.");
    if (body.id !== undefined && !validGraphId(body.id)) throw new MailError(400, "Rascunho inválido.");
    if (mode !== "new" && !body.id && !validGraphId(body.sourceId)) throw new MailError(400, "Indique a mensagem a responder.");
    if (typeof body.html !== "string" || body.html.length > 3_000_000) throw new MailError(400, "Texto da mensagem inválido.");
    // A reply opened for the first time may leave subject and recipients to Outlook (it applies Reply-To and removes the sender's own address).
    const outlookDefaults = mode !== "new" && !body.id && body.to === undefined;
    if (!(outlookDefaults && body.subject === undefined) && (typeof body.subject !== "string" || body.subject.length > 900 || /[\r\n]/.test(body.subject))) throw new MailError(400, "Assunto inválido.");
    if (body.quoteHtml !== undefined && (typeof body.quoteHtml !== "string" || body.quoteHtml.length > 3_000_000)) throw new MailError(400, "Mensagem original inválida.");
    const importance = ["low", "normal", "high"].includes(body.importance) ? body.importance : "normal";
    let recipients: RecipientLists;
    if (body.send && outlookDefaults) throw new MailError(400, "Abra a resposta antes de enviar.");
    if (body.send) {
      try { recipients = validateRecipients(body); } catch (error) { throw new MailError(400, (error as Error).message); }
      if (!body.subject.trim() && !body.allowEmptySubject) throw new MailError(422, "A mensagem não tem assunto.");
    } else {
      // Drafts keep what is valid so far; Send validates strictly.
      const pick = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string").map(normalizeAddress).filter(validAddress).slice(0, 50);
      recipients = { to: pick(body.to), cc: pick(body.cc), bcc: pick(body.bcc) };
    }
    const token = await applicationToken();
    let id: string = body.id;
    let quote: string = typeof body.quoteHtml === "string" ? body.quoteHtml : "";
    let created: { subject?: string; toRecipients?: { emailAddress?: { address?: string } }[]; ccRecipients?: { emailAddress?: { address?: string } }[] } | null = null;
    if (!id) {
      const draft = mode === "new"
        ? await graphWrite(token, user.email, "/messages", "POST", { subject: body.subject, body: { contentType: "HTML", content: "" } }, "Não foi possível criar o rascunho no Outlook.")
        : await graphWrite(token, user.email, `/messages/${encodeURIComponent(body.sourceId)}/${MODES[mode]}`, "POST", {}, "Não foi possível preparar a resposta no Outlook.");
      if (!validGraphId(draft?.id)) throw new MailError(502, "A Microsoft não devolveu um rascunho válido. Consulte os Rascunhos.");
      id = draft.id; created = draft;
      if (mode !== "new") quote = draft.body?.content ?? (await readGraph(token, user.email, `/messages/${encodeURIComponent(id)}?$select=body`)).body?.content ?? "";
    } else await requireDraft(token, user.email, id);
    await graphWrite(token, user.email, `/messages/${encodeURIComponent(id)}`, "PATCH", {
      ...(outlookDefaults ? {} : { subject: body.subject, toRecipients: parties(recipients.to), ccRecipients: parties(recipients.cc), bccRecipients: parties(recipients.bcc) }),
      importance,
      body: { contentType: "HTML", content: combineDraftBody(sanitizeComposeHtml(body.html), quote) },
    }, "Não foi possível guardar o rascunho. O texto continua no editor.");
    if (body.send) {
      await graphWrite(token, user.email, `/messages/${encodeURIComponent(id)}/send`, "POST", undefined, "A Microsoft não confirmou o envio. Consulte os Itens Enviados antes de tentar novamente.");
      return json({ ok: true, sent: true, id });
    }
    const list = (value?: { emailAddress?: { address?: string } }[]) => (value ?? []).map(item => normalizeAddress(item.emailAddress?.address || "")).filter(validAddress);
    return json({ ok: true, id, quoteHtml: quote, savedAt: new Date().toISOString(), ...(outlookDefaults && created ? { subject: created.subject || "", to: list(created.toRecipients), cc: list(created.ccRecipients) } : {}) });
  } catch (error) { return mailError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    const id = new URL(request.url).searchParams.get("id");
    if (!validGraphId(id)) throw new MailError(400, "Rascunho inválido.");
    const token = await applicationToken();
    await requireDraft(token, user.email, id);
    await graphWrite(token, user.email, `/messages/${encodeURIComponent(id)}`, "DELETE");
    return json({ ok: true });
  } catch (error) { return mailError(error); }
}
