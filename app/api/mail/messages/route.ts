import { liveMail, type GraphMessage } from "../../../mail-matching";
import { applicationToken, json, knownMail, MailError, mailError, mailSession, readGraph, readGraphUrl } from "../server";
import { cursorUrl, nextCursor } from "../cursor";
import { folderRef, LIST_FIELDS } from "../graph-write";
export const dynamic = "force-dynamic";

const FILTERS: Record<string, string> = { unread: "isRead eq false", flagged: "flag/flagStatus eq 'flagged'", attachments: "hasAttachments eq true", important: "importance eq 'high'" };

export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const params = new URL(request.url).searchParams;
    const folder = folderRef(params.get("folder") || "inbox");
    if (!folder) throw new MailError(400, "Pasta de correio inválida.");
    const filter = params.get("filter") || "all";
    if (filter !== "all" && !FILTERS[filter]) throw new MailError(400, "Filtro inválido.");
    const scope = params.get("scope") === "all" ? "all" : "folder";
    const q = (params.get("q") || "").trim();
    if (q.length > 250 || /[\r\n]/.test(q)) throw new MailError(400, "A pesquisa deve ter até 250 caracteres.");
    const key = JSON.stringify([user.email.toLowerCase(), "v2", folder, filter, scope, q]);
    const page = params.get("page");
    const next = page ? await cursorUrl(page, user.id, key) : null;
    const [token, index] = await Promise.all([applicationToken(), knownMail(db)]);
    const outgoing = folder === "sentitems" || folder === "drafts" || folder === "outbox";
    const dateField = folder === "drafts" ? "lastModifiedDateTime" : folder === "sentitems" ? "sentDateTime" : "receivedDateTime";
    const query = new URLSearchParams({ "$select": LIST_FIELDS, "$top": "40" });
    if (q) {
      // Graph search ranks its own results and cannot be combined with $orderby or $filter.
      query.set("$search", `"${q.replace(/["\\]/g, " ")}"`);
    } else {
      query.set("$orderby", `${dateField} desc`);
      // With $orderby, Graph requires the ordered property to lead the filter.
      if (filter !== "all") query.set("$filter", `${dateField} ge 1900-01-01T00:00:00Z and ${FILTERS[filter]}`);
    }
    const base = q && scope === "all" ? "/messages" : `/mailFolders/${encodeURIComponent(folder)}/messages`;
    const result = next ? await readGraphUrl(token, next) : await readGraph(token, user.email, `${base}?${query}`);
    const own = user.email.toLowerCase();
    let mensagens = (result.value as GraphMessage[]).map(message => {
      const fromSelf = message.from?.emailAddress?.address?.toLowerCase() === own;
      return liveMail(message, outgoing || (scope === "all" && fromSelf) ? "out" : "in", index);
    });
    if (q && filter !== "all") mensagens = mensagens.filter(message => {
      const item = message as GraphMessage & { flag?: { flagStatus?: string }; hasAttachments?: boolean; importance?: string };
      return filter === "unread" ? !item.isRead : filter === "flagged" ? item.flag?.flagStatus === "flagged" : filter === "attachments" ? item.hasAttachments : item.importance === "high";
    });
    return json({ mensagens, nextPage: await nextCursor(result["@odata.nextLink"], user.id, key) });
  } catch (error) { return mailError(error); }
}
