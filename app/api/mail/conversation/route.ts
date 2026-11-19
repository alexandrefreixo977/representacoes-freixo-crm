import { liveMail, type GraphMessage } from "../../../mail-matching";
import { validGraphId } from "../../../mail-content";
import { applicationToken, json, knownMail, MailError, mailError, mailSession, readGraph } from "../server";
import { LIST_FIELDS } from "../graph-write";
export const dynamic = "force-dynamic";
// Every message of one conversation, across folders, oldest first (as in Outlook's reading pane).
export async function GET(request: Request) {
  try {
    const { db, user } = await mailSession(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!validGraphId(id)) throw new MailError(400, "Conversa inválida.");
    const [token, index] = await Promise.all([applicationToken(), knownMail(db)]);
    const query = new URLSearchParams({ "$select": LIST_FIELDS, "$top": "60", "$filter": `conversationId eq '${id.replace(/'/g, "''")}'` });
    const [result, deleted] = await Promise.all([
      readGraph(token, user.email, `/messages?${query}`),
      readGraph(token, user.email, "/mailFolders/deleteditems?$select=id").catch(() => ({ id: "" })),
    ]);
    const own = user.email.toLowerCase();
    const mensagens = (result.value as GraphMessage[])
      .map(message => ({ ...liveMail(message, message.from?.emailAddress?.address?.toLowerCase() === own || message.isDraft ? "out" : "in", index), deleted: message.parentFolderId === deleted.id }))
      .sort((a, b) => Date.parse(a.receivedDateTime || a.sentDateTime || a.lastModifiedDateTime || "") - Date.parse(b.receivedDateTime || b.sentDateTime || b.lastModifiedDateTime || ""));
    return json({ mensagens });
  } catch (error) { return mailError(error); }
}
