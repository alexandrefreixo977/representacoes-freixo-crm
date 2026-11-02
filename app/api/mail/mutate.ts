import { applicationToken, json, MailError, mailError, mailSession, readGraph } from "./server";
import { validGraphId } from "../../mail-content";
import { requireMailPermission } from './server';

export async function mutateMessage(request: Request, action: "delete" | "mark-read") {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    let body;
    try { body = await request.json(); } catch { throw new MailError(400, "Mensagem inválida."); }
    if (!validGraphId(body?.messageId)) throw new MailError(400, "Mensagem inválida.");
    const token = await applicationToken();
    const path = `/messages/${encodeURIComponent(body.messageId)}`;
    if (action === "delete") {
      // A repeated request must never delete an item from Deleted Items itself.
      const [message, deleted] = await Promise.all([
        readGraph(token, user.email, path + "?$select=parentFolderId"),
        readGraph(token, user.email, "/mailFolders/deleteditems?$select=id"),
      ]);
      if (message.parentFolderId === deleted.id) return json({ ok: true });
    }
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user.email)}${path}`, {
      method: action === "delete" ? "DELETE" : "PATCH", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' },
      ...(action === "mark-read" ? { body: JSON.stringify({ isRead: true }) } : {}),
    });
    if (!response.ok) throw new MailError([403, 404, 429].includes(response.status) ? response.status : 502,
      response.status === 403 ? "A Microsoft recusou a alteração. Confirme a permissão Mail.ReadWrite para esta caixa." : "Não foi possível confirmar a alteração no Outlook. Atualize o correio antes de tentar novamente.", response.headers.get("Retry-After") || undefined);
    return json({ ok: true });
  } catch (error) { return mailError(error); }
}
