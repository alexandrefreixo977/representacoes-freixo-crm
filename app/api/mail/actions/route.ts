import { applicationToken, json, MailError, mailError, mailSession, readGraph, requireMailPermission } from "../server";
import { validGraphId } from "../../../mail-content";
import { folderRef, graphBatch } from "../graph-write";
export const dynamic = "force-dynamic";

const ACTIONS = ["read", "unread", "flag", "unflag", "complete", "categorize", "move", "delete", "purge"] as const;
type Action = typeof ACTIONS[number];

export async function POST(request: Request) {
  try {
    const { user, db } = await mailSession(request);
    await requireMailPermission(db);
    let body: { action?: Action; ids?: unknown; destination?: unknown; categories?: Record<string, unknown> };
    try { body = await request.json(); } catch { throw new MailError(400, "Pedido inválido."); }
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) throw new MailError(400, "Ação inválida.");
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : [];
    if (!ids.length || ids.length > 100 || !ids.every(validGraphId)) throw new MailError(400, "Selecione entre 1 e 100 mensagens.");
    const token = await applicationToken();
    let destination: string | null = null;
    if (action === "move") {
      destination = folderRef(body.destination);
      if (!destination) throw new MailError(400, "Pasta de destino inválida.");
      // Resolve well-known names so the client can compare folder ids afterwards.
      destination = (await readGraph(token, user.email, `/mailFolders/${encodeURIComponent(destination)}?$select=id`)).id as string;
    }
    if (action === "delete" || action === "purge") {
      // Delete moves to Itens Eliminados; only messages already there (or in junk) can be removed for good.
      const [deleted, junk, ...current] = await Promise.all([
        readGraph(token, user.email, "/mailFolders/deleteditems?$select=id"),
        readGraph(token, user.email, "/mailFolders/junkemail?$select=id").catch(() => ({ id: "" })),
        ...ids.map(id => readGraph(token, user.email, `/messages/${encodeURIComponent(id)}?$select=parentFolderId`).catch(() => ({ parentFolderId: "" }))),
      ]);
      const inBin = (index: number) => current[index].parentFolderId === deleted.id || (junk.id && current[index].parentFolderId === junk.id);
      if (action === "purge" && ids.some((_, index) => !inBin(index))) throw new MailError(409, "Só pode eliminar definitivamente mensagens que estão em Itens Eliminados ou no Lixo Eletrónico.");
      if (action === "delete") {
        const requests = ids.flatMap((id, index) => inBin(index) ? [] : [{ id: String(index), method: "POST", url: `/messages/${encodeURIComponent(id)}/move`, body: { destinationId: deleted.id } }]);
        const results = await graphBatch(token, user.email, requests);
        return json(summary(ids, results, deleted.id));
      }
    }
    const requests = ids.map((id, index) => {
      const url = `/messages/${encodeURIComponent(id)}`;
      switch (action) {
        case "read": case "unread": return { id: String(index), method: "PATCH", url, body: { isRead: action === "read" } };
        case "flag": case "unflag": case "complete": return { id: String(index), method: "PATCH", url, body: { flag: { flagStatus: action === "flag" ? "flagged" : action === "complete" ? "complete" : "notFlagged" } } };
        case "categorize": {
          const list = body.categories?.[id];
          if (!Array.isArray(list) || list.length > 25 || !list.every(item => typeof item === "string" && item.length > 0 && item.length <= 255)) throw new MailError(400, "Categorias inválidas.");
          return { id: String(index), method: "PATCH", url, body: { categories: list } };
        }
        case "move": return { id: String(index), method: "POST", url: url + "/move", body: { destinationId: destination } };
        default: return { id: String(index), method: "POST", url: url + "/permanentDelete", body: {} };
      }
    });
    const results = await graphBatch(token, user.email, requests);
    return json(summary(ids, results, destination ?? undefined));
  } catch (error) { return mailError(error); }
}

function summary(ids: string[], results: Map<string, { status: number }>, folderId?: string) {
  const failed = ids.filter((_, index) => { const result = results.get(String(index)); return result ? result.status >= 300 : false; });
  return { ok: failed.length === 0, failed, folderId };
}
