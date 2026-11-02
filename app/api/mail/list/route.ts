import { liveMail, type GraphMessage } from "../../../mail-matching";
import { applicationToken, json, knownMail, MailError, mailError, mailSession, readGraph, readGraphUrl } from "../server";
import { cursorUrl, nextCursor } from "../cursor";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const params = new URL(request.url).searchParams;
    const folder = params.get("folder") || "inbox";
    if (folder !== "inbox" && folder !== "sentitems") throw new MailError(400, "Pasta de correio inválida.");
    const q = (params.get("q") || "").trim();
    if (q.length > 250 || /[\r\n]/.test(q)) throw new MailError(400, "A pesquisa deve ter até 250 caracteres.");
    const scope = JSON.stringify([user.email.toLowerCase(), folder, q]);
    const page = params.get("page");
    const next = page ? await cursorUrl(page, user.id, scope) : null;
    const [token, index] = await Promise.all([applicationToken(), knownMail(db)]);
    const query = new URLSearchParams({ "$select": "id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,isRead", "$top": "25" });
    // Graph search supplies its own ordering and cannot be combined with $orderby.
    if (q) query.set("$search", `"${q.replace(/["\\]/g, " ")}"`);
    else query.set("$orderby", `${folder === "sentitems" ? "sentDateTime" : "receivedDateTime"} desc`);
    const result = next ? await readGraphUrl(token, next) : await readGraph(token, user.email, `/mailFolders/${folder}/messages?${query}`);
    return json({ mensagens: (result.value as GraphMessage[]).map(message => liveMail(message, folder === "inbox" ? "in" : "out", index)), nextPage: await nextCursor(result["@odata.nextLink"], user.id, scope) });
  } catch (error) { return mailError(error); }
}
